// Discord Embedded App SDK integration.
// Returns null when not running inside Discord (standalone web mode).

let sdkModulePromise;
async function loadSdk() {
  if (!sdkModulePromise) sdkModulePromise = import('@discord/embedded-app-sdk');
  return sdkModulePromise;
}

export function isInsideDiscord() {
  const p = new URLSearchParams(window.location.search);
  // Discord injects frame_id / instance_id when launching an Activity.
  return p.has('frame_id') || p.has('instance_id');
}

// The activity instance id is present in the launch URL — usable even if the
// SDK handshake fails, so players still auto-group into the same room.
export function urlInstanceId() {
  const p = new URLSearchParams(window.location.search);
  return p.get('instance_id') || null;
}

async function fetchClientId() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    return cfg.discordClientId || '';
  } catch {
    return '';
  }
}

/**
 * @returns {Promise<null | { instanceId, user, sdk }>}
 */
export async function initDiscord() {
  if (!isInsideDiscord()) return null;

  const clientId = await fetchClientId();
  let sdk;
  try {
    const { DiscordSDK } = await loadSdk();
    sdk = new DiscordSDK(clientId);
    await sdk.ready();
  } catch (err) {
    console.warn('Discord SDK failed to init', err);
    // Even if the SDK misbehaves, fall back to the instance id from the URL
    // so everyone in the same activity still lands in the same room.
    const p = new URLSearchParams(window.location.search);
    return { instanceId: p.get('instance_id') || 'discord', user: null, sdk: null };
  }

  let user = null;
  // Best-effort authentication to learn the player's display name.
  if (clientId) {
    try {
      const { code } = await sdk.commands.authorize({
        client_id: clientId,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: ['identify'],
      });
      const res = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const { access_token } = await res.json();
      const auth = await sdk.commands.authenticate({ access_token });
      user = auth?.user || null;
    } catch (err) {
      console.warn('Discord auth skipped', err);
    }
  }

  return { instanceId: sdk.instanceId || 'discord', user, sdk };
}

export function discordDisplayName(user) {
  if (!user) return '';
  return user.global_name || user.username || '';
}

// Build a SAME-ORIGIN URL for a Discord user's avatar, proxied through our own
// server (/dcdn/...). A same-origin path is required because the Discord
// Activity CSP blocks direct requests to cdn.discordapp.com — a relative path
// also works fine on the standalone web. Returns '' if we can't build one.
export function discordAvatarUrl(user) {
  if (!user || !user.id) return '';
  try {
    if (user.avatar) {
      const ext = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
      return `/dcdn/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
    }
    let idx = 0;
    if (user.discriminator && user.discriminator !== '0') idx = parseInt(user.discriminator, 10) % 5;
    else idx = Number((BigInt(user.id) >> 22n) % 6n);
    return `/dcdn/embed/avatars/${idx}.png`;
  } catch {
    return '';
  }
}
