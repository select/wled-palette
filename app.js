// ---- WLED Palette Editor ----
// Palette stops use WLED-native positions 0..255.
// Output format: {"palette":[pos,"rrggbb", pos,"rrggbb", ...]}

const MAXPOS = 255;

// ---- State ----
let stops = [
  { pos: 0, hex: "2A7B9B" },
  { pos: 128, hex: "57C785" },
  { pos: 255, hex: "EDDD53" },
];
let selected = 1;
let hsv = { h: 0, s: 0, v: 0 }; // current picker state for selected stop

// Example palettes (WLED-style)
const EXAMPLES = {
  "Evening Clouds": [[0,"714550"],[43,"7f5968"],[85,"8e9dba"],[128,"af6365"],[170,"d09899"],[213,"dbc6cb"],[255,"fbe7dd"]],
  "Ocean": [[0,"001c70"],[64,"2060ff"],[128,"00b3c3"],[255,"a0f0e0"]],
  "Sunset": [[0,"2b1055"],[90,"7597de"],[160,"ff7e5f"],[210,"feb47b"],[255,"ffe29a"]],
  "Fire": [[0,"000000"],[80,"7a0000"],[150,"ff4500"],[210,"ffd000"],[255,"ffffff"]],
  "Rainbow": [[0,"ff0000"],[42,"ffff00"],[85,"00ff00"],[128,"00ffff"],[170,"0000ff"],[213,"ff00ff"],[255,"ff0000"]],
  "Pastel": [[0,"ffd1dc"],[85,"c9f0ff"],[170,"d4ffea"],[255,"fff3c4"]],
};

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const track = $("track"), bar = $("bar"), posLabels = $("posLabels");
const svBox = $("svBox"), svCursor = $("svCursor");
const hueSlider = $("hueSlider"), hueCursor = $("hueCursor");
const hexInput = $("hexInput"), rIn = $("rIn"), gIn = $("gIn"), bIn = $("bIn");
const stopsList = $("stopsList"), jsonOut = $("jsonOut"), meta = $("meta");

// ---- Color helpers ----
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function hexToRgb(hex) {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  return [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

// ---- Rendering ----
function sortStops() {
  const sel = stops[selected];
  stops.sort((a, b) => a.pos - b.pos);
  // WLED requires the gradient to span the full 0..255 range:
  // first stop is locked to 0, last stop locked to 255.
  stops[0].pos = 0;
  stops[stops.length - 1].pos = MAXPOS;
  selected = stops.indexOf(sel);
}

// An endpoint is the first (pos 0) or last (pos 255) stop after sorting.
function isEndpoint(i) {
  return i === 0 || i === stops.length - 1;
}

function gradientCss() {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const parts = sorted.map(s => `#${s.hex} ${(s.pos / MAXPOS * 100).toFixed(2)}%`);
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

function render() {
  sortStops();
  bar.style.background = gradientCss();

  // handles
  track.querySelectorAll(".stop-handle").forEach(h => h.remove());
  stops.forEach((s, i) => {
    const h = document.createElement("div");
    h.className = "stop-handle" + (i === selected ? " selected" : "");
    if (isEndpoint(i)) h.style.cursor = "default";
    h.style.left = (s.pos / MAXPOS * 100) + "%";
    h.style.background = `#${s.hex}`;
    h.dataset.idx = i;
    track.appendChild(h);
    attachDrag(h, i);
  });

  // position labels
  posLabels.innerHTML = "";
  stops.forEach(s => {
    const l = document.createElement("div");
    l.className = "pos-label";
    l.style.left = (s.pos / MAXPOS * 100) + "%";
    l.textContent = s.pos;
    posLabels.appendChild(l);
  });

  renderStopsList();
  syncPickerFromSelected();
  renderOutput();
}

function renderStopsList() {
  stopsList.innerHTML = "";
  stops.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "stop-row" + (i === selected ? " selected" : "");

    const sw = document.createElement("div");
    sw.className = "stop-color";
    sw.style.background = `#${s.hex}`;
    sw.onclick = () => { selected = i; render(); };

    const hex = document.createElement("input");
    hex.className = "stop-hex";
    hex.value = "#" + s.hex;
    hex.onfocus = () => { selected = i; render(); };
    hex.oninput = () => {
      const v = hex.value.replace("#", "");
      if (/^[0-9a-fA-F]{6}$/.test(v)) { s.hex = v.toUpperCase(); render(); }
    };

    const endpoint = isEndpoint(i);
    const pos = document.createElement("input");
    pos.className = "stop-pos";
    pos.type = "number"; pos.min = 0; pos.max = MAXPOS;
    pos.value = s.pos;
    pos.disabled = endpoint; // endpoints locked to 0 / 255
    pos.title = endpoint ? "Endpoint position is locked (WLED requires 0 and 255)" : "";
    pos.onfocus = () => { selected = i; render(); };
    pos.oninput = () => {
      s.pos = clamp(parseInt(pos.value) || 0, 1, MAXPOS - 1);
      bar.style.background = gradientCss();
    };
    pos.onblur = () => render();

    const del = document.createElement("button");
    del.className = "stop-del";
    del.textContent = "×";
    del.disabled = endpoint; // cannot delete endpoints
    del.title = endpoint ? "Endpoints cannot be deleted" : "";
    del.onclick = () => {
      if (isEndpoint(i)) return;
      stops.splice(i, 1);
      selected = clamp(selected, 0, stops.length - 1);
      render();
    };

    row.append(sw, hex, pos, del);
    stopsList.appendChild(row);
  });
}

function renderOutput() {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  const arr = [];
  sorted.forEach(s => { arr.push(s.pos, `"${s.hex.toLowerCase()}"`); });
  jsonOut.textContent = `{"palette":[${arr.join(",")}]}`;
  meta.textContent = `${stops.length} stops`;
}

// ---- Picker sync ----
function syncPickerFromSelected() {
  const { r, g, b } = hexToRgb(stops[selected].hex);
  hsv = rgbToHsv(r, g, b);
  hexInput.value = "#" + stops[selected].hex;
  rIn.value = r; gIn.value = g; bIn.value = b;

  // SV cursor
  svCursor.style.left = (hsv.s * 100) + "%";
  svCursor.style.top = ((1 - hsv.v) * 100) + "%";
  // SV box hue background
  const hueRgb = hsvToRgb(hsv.h, 1, 1);
  svBox.style.background = `rgb(${hueRgb.r},${hueRgb.g},${hueRgb.b})`;
  // hue cursor
  hueCursor.style.left = (hsv.h / 360 * 100) + "%";
}

function applyHsvToSelected() {
  const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
  stops[selected].hex = rgbToHex(r, g, b);
  render();
}

// ---- Drag handles on gradient bar ----
function attachDrag(handle, idx) {
  handle.onmousedown = (e) => {
    e.preventDefault();
    selected = idx; render();
    if (isEndpoint(idx)) return; // endpoints (0 / 255) are not draggable
    const rect = track.getBoundingClientRect();
    const move = (ev) => {
      const x = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
      stops[idx].pos = clamp(Math.round(x * MAXPOS), 1, MAXPOS - 1);
      bar.style.background = gradientCss();
      handle.style.left = (x * 100) + "%";
      // live position label update
      posLabels.children[idx] && (posLabels.children[idx].textContent = stops[idx].pos);
      posLabels.children[idx] && (posLabels.children[idx].style.left = (x * 100) + "%");
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      render();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
}

// Click on bar to add stop (only between the locked endpoints)
track.onclick = (e) => {
  if (e.target.classList.contains("stop-handle")) return;
  const rect = track.getBoundingClientRect();
  const pos = clamp(Math.round(clamp((e.clientX - rect.left) / rect.width, 0, 1) * MAXPOS), 1, MAXPOS - 1);
  if (stops.some(s => s.pos === pos)) return; // avoid duplicate position
  // sample color from current gradient at that position (interpolate)
  const hex = sampleGradient(pos);
  stops.push({ pos, hex });
  render();
  selected = stops.findIndex(s => s.pos === pos);
  render();
};

function sampleGradient(pos) {
  const sorted = [...stops].sort((a, b) => a.pos - b.pos);
  let lo = sorted[0], hi = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (pos >= sorted[i].pos && pos <= sorted[i + 1].pos) { lo = sorted[i]; hi = sorted[i + 1]; break; }
  }
  const span = hi.pos - lo.pos || 1;
  const t = clamp((pos - lo.pos) / span, 0, 1);
  const a = hexToRgb(lo.hex), b = hexToRgb(hi.hex);
  return rgbToHex(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

// ---- SV box interaction ----
function svPointer(e) {
  const rect = svBox.getBoundingClientRect();
  hsv.s = clamp((e.clientX - rect.left) / rect.width, 0, 1);
  hsv.v = 1 - clamp((e.clientY - rect.top) / rect.height, 0, 1);
  applyHsvToSelected();
}
svBox.onmousedown = (e) => {
  svPointer(e);
  const up = () => { document.removeEventListener("mousemove", svPointer); document.removeEventListener("mouseup", up); };
  document.addEventListener("mousemove", svPointer);
  document.addEventListener("mouseup", up);
};

// ---- Hue slider interaction ----
function huePointer(e) {
  const rect = hueSlider.getBoundingClientRect();
  hsv.h = clamp((e.clientX - rect.left) / rect.width, 0, 1) * 360;
  applyHsvToSelected();
}
hueSlider.onmousedown = (e) => {
  huePointer(e);
  const up = () => { document.removeEventListener("mousemove", huePointer); document.removeEventListener("mouseup", up); };
  document.addEventListener("mousemove", huePointer);
  document.addEventListener("mouseup", up);
};

// ---- Hex / RGB inputs ----
hexInput.oninput = () => {
  const v = hexInput.value.replace("#", "");
  if (/^[0-9a-fA-F]{6}$/.test(v)) { stops[selected].hex = v.toUpperCase(); render(); }
};
[rIn, gIn, bIn].forEach(inp => inp.oninput = () => {
  const r = clamp(parseInt(rIn.value) || 0, 0, 255);
  const g = clamp(parseInt(gIn.value) || 0, 0, 255);
  const b = clamp(parseInt(bIn.value) || 0, 0, 255);
  stops[selected].hex = rgbToHex(r, g, b);
  render();
});

// ---- Presets ----
const presetsEl = $("presets");
Object.entries(EXAMPLES).forEach(([name, data]) => {
  const sw = document.createElement("div");
  sw.className = "preset-swatch";
  sw.title = name;
  const parts = data.map(([p, h]) => `#${h} ${(p / MAXPOS * 100).toFixed(0)}%`);
  sw.style.background = `linear-gradient(to right, ${parts.join(", ")})`;
  sw.onclick = () => {
    stops = data.map(([pos, hex]) => ({ pos, hex: hex.toUpperCase() }));
    selected = 0;
    render();
  };
  presetsEl.appendChild(sw);
});

// ---- Actions ----
$("copyBtn").onclick = () => {
  navigator.clipboard.writeText(jsonOut.textContent).then(() => {
    const b = $("copyBtn"); const t = b.textContent;
    b.textContent = "Copied ✓";
    setTimeout(() => b.textContent = t, 1200);
  });
};
$("downloadBtn").onclick = () => {
  const blob = new Blob([jsonOut.textContent], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "palette0.json";
  a.click();
  URL.revokeObjectURL(a.href);
};

// ---- Image import (pywal16-style extraction) ----
const imgInput = $("imgInput"), preview = $("preview");
let lastImgSrc = null;

function reimport() {
  if (!lastImgSrc) return;
  const img = new Image();
  img.onload = () => {
    const opts = {
      colors: clamp(parseInt($("nColors").value) || 8, 3, 16),
      order: $("order").value,
      weight: $("weight").checked,
    };
    const s = Jswal.fromImage(img, opts);
    if (s.length >= 2) { stops = s; selected = 0; render(); }
  };
  img.src = lastImgSrc;
}

imgInput.onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const isJson = f.type === 'application/json' || f.name.toLowerCase().endsWith('.json');
  if (isJson) {
    const rd = new FileReader();
    rd.onload = () => {
      const ok = importPaletteJSON(rd.result);
      if (!ok) flashMeta("Invalid palette JSON — expected {\"palette\":[pos,\"rrggbb\", …]}");
    };
    rd.readAsText(f);
    // image preview no longer applies
    preview.classList.add("hidden");
    preview.removeAttribute("src");
    lastImgSrc = null;
    return;
  }
  const rd = new FileReader();
  rd.onload = () => {
    lastImgSrc = rd.result;
    preview.src = rd.result;
    preview.classList.remove("hidden");
    reimport();
  };
  rd.readAsDataURL(f);
};

["nColors", "order", "weight"].forEach(id => $(id).addEventListener("change", reimport));

// ---- Import existing WLED palette JSON (edit existing palettes) ----
// Accepts the editor's own output format {"palette":[pos,"rrggbb", …]},
// a bare [pos,"hex",…] array, or [{pos,hex}] objects.
function importPaletteJSON(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { return false; }

  let arr = null;
  if (Array.isArray(data)) arr = data;
  else if (data && Array.isArray(data.palette)) arr = data.palette;
  else if (data && Array.isArray(data.colors)) arr = data.colors;
  if (!arr) return false;

  const newStops = [];
  const normHex = (h) => String(h).replace("#", "").toUpperCase();
  const validHex = (h) => /^[0-9A-F]{6}$/.test(h);

  if (arr.length >= 2 && typeof arr[0] === "number" && typeof arr[1] === "string") {
    // flat [pos, "hex", pos, "hex", …]
    for (let i = 0; i + 1 < arr.length; i += 2) {
      const pos = arr[i], hex = normHex(arr[i + 1]);
      if (Number.isInteger(pos) && validHex(hex)) newStops.push({ pos, hex });
    }
  } else if (arr.length && typeof arr[0] === "object" && arr[0] !== null) {
    // [{pos, hex}, …]
    for (const e of arr) {
      if (e && Number.isInteger(e.pos) && typeof e.hex === "string") {
        const hex = normHex(e.hex);
        if (validHex(hex)) newStops.push({ pos: e.pos, hex });
      }
    }
  }
  if (newStops.length < 2) return false;

  stops = newStops;
  selected = 0;
  render();
  return true;
}

// Briefly surface import errors in the meta line under the JSON output.
let metaTimer = null;
function flashMeta(msg) {
  const prev = meta.textContent;
  meta.textContent = msg;
  clearTimeout(metaTimer);
  metaTimer = setTimeout(() => { meta.textContent = prev; }, 3000);
}

// ---- Init ----
render();
