import { buildDeck, CARDS, CARD_VALUE } from './cards.js';

const TOKENS_TO_WIN = { 2: 7, 3: 5, 4: 4 };

function defaultRng() {
  return Math.random();
}

/**
 * Authoritative Love Letter match engine (classic 16-card deck, 2–4 players).
 * A "match" is a series of rounds; each round awards a token to its winner.
 * First to TOKENS_TO_WIN wins the match.
 *
 * The engine holds ALL state. Clients only send intents (which card, target,
 * guess); the engine validates and mutates. Private info (Priest peek, Baron
 * reveal) is returned as `reveals` addressed to specific players.
 */
export class LoveLetterGame {
  constructor(playerList, { rng } = {}) {
    this.rng = rng || defaultRng;
    // players ordered by seat
    this.players = playerList.map((p) => ({
      id: p.id,
      name: p.name,
      hand: [],
      discard: [],
      tokens: 0,
      alive: true,          // in the current round
      protected: false,     // Handmaid
      connected: p.connected !== false,
    }));
    this.deck = [];
    this.burnCard = null;     // set-aside face-down card
    this.asideOpen = [];      // face-up cards (2-player variant)
    this.currentIndex = 0;
    this.phase = 'lobby';     // lobby | playing | roundEnd | gameOver
    this.round = 0;
    this.log = [];            // structured events for the current round
    this.roundResult = null;  // { winnerIds, reason }
    this.winnerId = null;     // match winner
    this.startingIndex = 0;   // who begins the next round
    this.tokensToWin = TOKENS_TO_WIN[playerList.length] || 4;
  }

  // ---------- utilities ----------
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  playerById(id) {
    return this.players.find((p) => p.id === id);
  }

  alivePlayers() {
    return this.players.filter((p) => p.alive);
  }

  currentPlayer() {
    return this.players[this.currentIndex];
  }

  logEvent(evt) {
    this.log.push(evt);
  }

  // ---------- match / round lifecycle ----------
  startMatch() {
    this.round = 0;
    this.players.forEach((p) => (p.tokens = 0));
    this.startingIndex = Math.floor(this.rng() * this.players.length);
    this.winnerId = null;
    this.startRound();
  }

  startRound() {
    this.round += 1;
    this.log = [];
    this.roundResult = null;
    this.deck = this.shuffle(buildDeck());
    this.asideOpen = [];

    // Burn one card face down.
    this.burnCard = this.deck.pop();

    // 2-player variant: reveal 3 cards face up.
    if (this.players.length === 2) {
      for (let i = 0; i < 3; i++) this.asideOpen.push(this.deck.pop());
    }

    // Reset players and deal one card each.
    this.players.forEach((p) => {
      p.hand = [this.deck.pop()];
      p.discard = [];
      p.alive = true;
      p.protected = false;
    });

    this.currentIndex = this.startingIndex % this.players.length;
    this.phase = 'playing';
    this.beginTurn();
  }

  // Advance to the next alive player after currentIndex, then begin their turn.
  advanceTurn() {
    for (let step = 1; step <= this.players.length; step++) {
      const idx = (this.currentIndex + step) % this.players.length;
      if (this.players[idx].alive) {
        this.currentIndex = idx;
        this.beginTurn();
        return;
      }
    }
  }

  // Start-of-turn: clear own protection, then draw a card.
  beginTurn() {
    const p = this.currentPlayer();
    p.protected = false;
    // Draw a card. Under normal play the deck is never empty here because the
    // round ends the moment the deck empties at end of a turn.
    if (this.deck.length === 0) {
      // Safety: nothing to draw -> resolve by showdown.
      this.showdown();
      return;
    }
    p.hand.push(this.deck.pop());
    this.phase = 'playing';
  }

  // ---------- targeting ----------
  // Valid targets for a card played by `actor`.
  validTargets(card, actor) {
    const others = this.players.filter(
      (p) => p.id !== actor.id && p.alive && !p.protected
    );
    if (card.canTargetSelf) {
      // Prince: self is always a legal target (own Handmaid does not stop you).
      return [actor, ...others];
    }
    return others;
  }

  // ---------- the main action ----------
  /**
   * @returns {{ ok:boolean, error?:string, reveals?:Array<{to:string, ...}> }}
   */
  playCard(playerId, { card: cardValue, targetId = null, guess = null } = {}) {
    if (this.phase !== 'playing') return { ok: false, error: 'Not in play phase.' };
    const actor = this.currentPlayer();
    if (!actor || actor.id !== playerId) return { ok: false, error: 'Not your turn.' };
    if (!actor.hand.includes(cardValue)) return { ok: false, error: 'You do not hold that card.' };

    const meta = CARDS[cardValue];
    if (!meta) return { ok: false, error: 'Unknown card.' };

    // --- Countess forcing rule ---
    const holdsCountess = actor.hand.includes(CARD_VALUE.COUNTESS);
    const holdsRoyalty =
      actor.hand.includes(CARD_VALUE.KING) || actor.hand.includes(CARD_VALUE.PRINCE);
    if (holdsCountess && holdsRoyalty && cardValue !== CARD_VALUE.COUNTESS) {
      return { ok: false, error: 'You must play the Countess when holding the King or Prince.' };
    }

    // --- Guard guess validation ---
    if (cardValue === CARD_VALUE.GUARD && guess !== null) {
      if (guess === CARD_VALUE.GUARD) return { ok: false, error: 'Cannot guess Guard.' };
      if (!CARDS[guess]) return { ok: false, error: 'Invalid guess.' };
    }

    // Remove the played card from hand first, so remaining-card logic (Baron,
    // Prince self, King) sees the correct hand.
    const idx = actor.hand.indexOf(cardValue);
    actor.hand.splice(idx, 1);

    const reveals = [];
    const targets = this.validTargets(meta, actor);
    let chosen = null;
    if (meta.needsTarget) {
      if (targets.length === 0) {
        // No legal target (everyone protected / out): card has no effect.
        this.logEvent({ t: 'noTarget', a: actor.id, card: cardValue });
      } else {
        chosen = this.playerById(targetId);
        if (!chosen || !targets.includes(chosen)) {
          // invalid target -> rollback the removed card
          actor.hand.splice(idx, 0, cardValue);
          return { ok: false, error: 'Invalid or illegal target.' };
        }
      }
    }

    // Log the base play (client renders text from this).
    this.logEvent({ t: 'play', a: actor.id, card: cardValue });

    // --- resolve effects ---
    if (chosen || !meta.needsTarget) {
      switch (cardValue) {
        case CARD_VALUE.GUARD: {
          if (chosen) {
            const hit = chosen.hand.includes(guess);
            this.logEvent({ t: 'guard', a: actor.id, target: chosen.id, guess, hit });
            if (hit) this.eliminate(chosen, actor.id);
          }
          break;
        }
        case CARD_VALUE.PRIEST: {
          if (chosen) {
            this.logEvent({ t: 'priest', a: actor.id, target: chosen.id });
            reveals.push({ to: actor.id, kind: 'priest', target: chosen.id, card: chosen.hand[0] });
          }
          break;
        }
        case CARD_VALUE.BARON: {
          if (chosen) {
            const mine = actor.hand[0];
            const theirs = chosen.hand[0];
            let result = 'tie';
            if (mine > theirs) result = 'actor';
            else if (theirs > mine) result = 'target';
            this.logEvent({ t: 'baron', a: actor.id, target: chosen.id, result });
            // Reveal both cards privately to the two involved players.
            reveals.push({ to: actor.id, kind: 'baron', target: chosen.id, yourCard: mine, theirCard: theirs, result });
            reveals.push({ to: chosen.id, kind: 'baron', target: actor.id, yourCard: theirs, theirCard: mine, result: result === 'actor' ? 'target' : result === 'target' ? 'actor' : 'tie' });
            if (result === 'actor') this.eliminate(chosen, actor.id);
            else if (result === 'target') this.eliminate(actor, chosen.id);
          }
          break;
        }
        case CARD_VALUE.HANDMAID: {
          actor.protected = true;
          this.logEvent({ t: 'handmaid', a: actor.id });
          break;
        }
        case CARD_VALUE.PRINCE: {
          const victim = chosen; // always defined (self is legal)
          const discarded = victim.hand.pop();
          victim.discard.push(discarded);
          this.logEvent({ t: 'prince', a: actor.id, target: victim.id, discarded });
          if (discarded === CARD_VALUE.PRINCESS) {
            this.eliminate(victim, actor.id, /*alreadyDiscarded*/ true);
          } else {
            // Draw a replacement; if the deck is empty, use the burn card.
            let newCard;
            if (this.deck.length > 0) newCard = this.deck.pop();
            else if (this.burnCard !== null) { newCard = this.burnCard; this.burnCard = null; }
            if (newCard !== undefined) victim.hand.push(newCard);
          }
          break;
        }
        case CARD_VALUE.KING: {
          if (chosen) {
            this.logEvent({ t: 'king', a: actor.id, target: chosen.id });
            const mine = actor.hand[0];
            const theirs = chosen.hand[0];
            actor.hand[0] = theirs;
            chosen.hand[0] = mine;
            // Both players privately learn the card they received.
            reveals.push({ to: actor.id, kind: 'king', target: chosen.id, card: theirs });
            reveals.push({ to: chosen.id, kind: 'king', target: actor.id, card: mine });
          }
          break;
        }
        case CARD_VALUE.COUNTESS: {
          this.logEvent({ t: 'countess', a: actor.id });
          break;
        }
        case CARD_VALUE.PRINCESS: {
          this.logEvent({ t: 'princess', a: actor.id });
          break; // elimination handled below
        }
      }
    }

    // The played card goes to the actor's discard pile.
    actor.discard.push(cardValue);

    // Playing/discarding the Princess eliminates you.
    if (cardValue === CARD_VALUE.PRINCESS && actor.alive) {
      this.eliminate(actor, null, /*alreadyDiscarded*/ true);
    }

    // ---------- resolve end of turn ----------
    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      this.endRoundBySurvival(alive[0] || null);
    } else if (this.deck.length === 0) {
      this.showdown();
    } else {
      this.advanceTurn();
    }

    return { ok: true, reveals };
  }

  eliminate(player, byId = null, alreadyDiscarded = false) {
    if (!player.alive) return;
    player.alive = false;
    // Reveal remaining hand into the discard pile (unless it was already moved).
    // `revealed` records which card(s) became publicly known this way, so the
    // log/discard-tracking UI can show exactly what was uncovered.
    let revealed = [];
    if (!alreadyDiscarded) {
      revealed = player.hand.slice();
      while (player.hand.length) player.discard.push(player.hand.pop());
    } else {
      player.hand = [];
    }
    this.logEvent({ t: 'out', p: player.id, by: byId, revealed });
  }

  // ---------- round resolution ----------
  endRoundBySurvival(survivor) {
    if (survivor) {
      survivor.tokens += 1;
      this.roundResult = { winnerIds: [survivor.id], reason: 'survivor' };
      this.logEvent({ t: 'roundWin', winners: [survivor.id], reason: 'survivor' });
      this.startingIndex = this.players.indexOf(survivor);
    } else {
      this.roundResult = { winnerIds: [], reason: 'none' };
    }
    this.finishRound();
  }

  showdown() {
    const alive = this.alivePlayers();
    // Highest card value wins; tie broken by higher sum of discard pile.
    let best = -1;
    alive.forEach((p) => { best = Math.max(best, p.hand[0] ?? -1); });
    let contenders = alive.filter((p) => (p.hand[0] ?? -1) === best);

    if (contenders.length > 1) {
      let bestSum = -1;
      const sum = (p) => p.discard.reduce((a, b) => a + b, 0);
      contenders.forEach((p) => { bestSum = Math.max(bestSum, sum(p)); });
      contenders = contenders.filter((p) => sum(p) === bestSum);
    }

    // Reveal all remaining hands publicly at showdown.
    const reveal = alive.map((p) => ({ id: p.id, card: p.hand[0] ?? null }));
    contenders.forEach((p) => (p.tokens += 1));
    this.roundResult = {
      winnerIds: contenders.map((p) => p.id),
      reason: 'showdown',
      reveal,
    };
    this.logEvent({ t: 'roundWin', winners: contenders.map((p) => p.id), reason: 'showdown', reveal });
    if (contenders[0]) this.startingIndex = this.players.indexOf(contenders[0]);
    this.finishRound();
  }

  finishRound() {
    // Check for a match winner.
    const champ = this.players.find((p) => p.tokens >= this.tokensToWin);
    if (champ) {
      this.winnerId = champ.id;
      this.phase = 'gameOver';
      this.logEvent({ t: 'gameOver', winner: champ.id });
    } else {
      this.phase = 'roundEnd';
    }
  }

  // ---------- serialization ----------
  // Returns a view of the state safe to send to `viewerId`
  // (their own hand is visible; other hands are hidden unless revealed).
  serializeFor(viewerId) {
    const gameOver = this.phase === 'gameOver';
    return {
      phase: this.phase,
      round: this.round,
      tokensToWin: this.tokensToWin,
      deckCount: this.deck.length,
      burnCount: this.burnCard === null ? 0 : 1,
      asideOpen: this.asideOpen.slice(),
      currentPlayerId: this.phase === 'playing' ? this.currentPlayer()?.id : null,
      winnerId: this.winnerId,
      roundResult: this.roundResult,
      log: this.log,
      players: this.players.map((p) => {
        const showHand =
          p.id === viewerId ||           // your own hand
          gameOver ||                    // reveal at match end
          (this.roundResult && (this.roundResult.reason === 'showdown')); // showdown reveal
        return {
          id: p.id,
          name: p.name,
          tokens: p.tokens,
          alive: p.alive,
          protected: p.protected,
          connected: p.connected,
          handCount: p.hand.length,
          hand: showHand ? p.hand.slice() : null,
          discard: p.discard.slice(),
          isCurrent: this.phase === 'playing' && this.currentPlayer()?.id === p.id,
        };
      }),
    };
  }
}
