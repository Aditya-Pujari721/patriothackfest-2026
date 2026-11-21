const captureStatus = document.getElementById('captureStatus');
const captureQueue = 'scanner-debug-outbox-v1';
const localServer = location.pathname.startsWith('/live/') || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ||
  new URLSearchParams(location.search).get('local') === '1';
let uploading = false;

async function storeCapture(metrics, raw, hud) {
  try {
    const now = new Date();
    const timestamp = now.toISOString();
    const stamp = timestamp.replace(/[-:]/g, '').replace('T', '_').replace('.', '_').slice(0, 19);
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => byte.toString(16).padStart(2, '0')).join('');
    metrics.timestamp = timestamp;
    metrics.capture_id = (metrics.is_calibration ? 'CAL_' : 'SCAN_') + stamp + '_' + nonce;
    const payload = JSON.stringify({metrics, raw, hud});
    if (localServer) {
      try {
        await uploadCapture(payload);
        captureStatus.textContent = 'Saved to debug_captures.';
        return;
      } catch {
        // Keep a failed upload for the next time the laptop is reachable.
      }
    }
    const queue = await caches.open(captureQueue);
    await queue.put('./pending/' + metrics.capture_id, new Response(payload));
    captureStatus.textContent = 'Debug capture queued on this device.';
  } catch (error) {
    captureStatus.textContent = 'Could not save debug capture: ' + error.message;
    return;
  }
  flushCaptures();
}

async function uploadCapture(body) {
  const response = await fetch('./api/captures', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body, signal: AbortSignal.timeout(8000)
  });
  if (response.status !== 204) throw new Error('Laptop returned HTTP ' + response.status);
}

async function flushCaptures() {
  if (uploading) return;
  uploading = true;
  try {
    const queue = await caches.open(captureQueue);
    const keys = await queue.keys();
    if (!localServer) {
      document.getElementById('exportCaptures').hidden = !keys.length;
      captureStatus.textContent = keys.length ? `Saved on this device: ${keys.length} captures.` : 'Debug captures enabled';
      return;
    }
    for (const key of keys) {
      const saved = await queue.match(key);
      if (!saved) continue;
      await uploadCapture(await saved.blob());
      await queue.delete(key);
      captureStatus.textContent = 'Saved to debug_captures.';
    }
  } catch (error) {
    captureStatus.textContent = 'Upload pending: ' + error.message;
  } finally {
    uploading = false;
  }
}
window.addEventListener('online', flushCaptures);
if (localServer) setInterval(flushCaptures, 5000);
flushCaptures();

// A standard tar archive keeps each JPEG and JSON together without an online dependency.
function appendFile(parts, name, bytes) {
  const header = new Uint8Array(512);
  const encoder = new TextEncoder();
  const field = (offset, value) => header.set(encoder.encode(value), offset);
  field(0, name);
  field(100, '0000644');
  field(108, '0000000');
  field(116, '0000000');
  field(124, bytes.length.toString(8).padStart(11, '0'));
  field(136, Math.floor(Date.now() / 1000).toString(8).padStart(11, '0'));
  field(148, '        ');
  field(156, '0');
  field(257, 'ustar');
  field(263, '00');
  const checksum = header.reduce((total, byte) => total + byte, 0);
  field(148, checksum.toString(8).padStart(6, '0') + '\0 ');
  parts.push(header, bytes, new Uint8Array((512 - bytes.length % 512) % 512));
}

async function exportCaptures() {
  try {
    const queue = await caches.open(captureQueue);
    const parts = [];
    for (const key of await queue.keys()) {
      const capture = await (await queue.match(key)).json();
      const name = 'debug_captures/' + capture.metrics.capture_id;
      appendFile(parts, name + '_metrics.json', new TextEncoder().encode(JSON.stringify(capture.metrics, null, 2)));
      for (const label of ['raw', 'hud']) {
        appendFile(parts, name + '_' + label + '.jpg', Uint8Array.from(atob(capture[label]), c => c.charCodeAt(0)));
      }
    }
    if (!parts.length) return;
    parts.push(new Uint8Array(1024));
    const url = URL.createObjectURL(new Blob(parts, {type: 'application/x-tar'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aquaspec-captures.tar';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    captureStatus.textContent = 'Export failed: ' + error.message;
  }
}
