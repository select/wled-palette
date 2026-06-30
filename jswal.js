// jswal.js — browser port of pywal16's color extraction.
//
// pywal16's default "wal" backend shells out to ImageMagick:
//   convert img -resize 25% -colors N -unique-colors txt:-
// which performs median-cut quantization and returns the palette.
//
// This module reproduces that in the browser:
//   1. downscale the image on a <canvas> (like -resize)
//   2. priority-queue median-cut quantization (like -colors N)
//   3. each resulting bucket keeps its pixel population (count)
//
// The population count powers the optional frequency weighting:
// more common colors get a wider band on the 0..255 gradient,
// pushing their neighbours further away.

const Jswal = (() => {
  // ---- 1. read + downscale pixels ----
  function getPixels(img, maxDim = 200) {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const px = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 125) continue; // skip transparent
      px.push([data[i], data[i + 1], data[i + 2]]);
    }
    return px;
  }

  // ---- 2. median-cut quantization ----
  function makeBucket(pixels) {
    let rMin = 255, gMin = 255, bMin = 255, rMax = 0, gMax = 0, bMax = 0;
    for (const [r, g, b] of pixels) {
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b < bMin) bMin = b; if (b > bMax) bMax = b;
    }
    const rRange = rMax - rMin, gRange = gMax - gMin, bRange = bMax - bMin;
    let channel = 0, range = rRange;
    if (gRange > range) { channel = 1; range = gRange; }
    if (bRange > range) { channel = 2; range = bRange; }
    return { pixels, channel, range, count: pixels.length };
  }

  function average(pixels) {
    let r = 0, g = 0, b = 0;
    for (const p of pixels) { r += p[0]; g += p[1]; b += p[2]; }
    const n = pixels.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }

  function quantize(pixels, count) {
    if (!pixels.length) return [];
    let buckets = [makeBucket(pixels)];
    while (buckets.length < count) {
      // split the bucket with the greatest spread × population
      let idx = -1, score = -1;
      for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i];
        if (b.count < 2 || b.range === 0) continue;
        const s = b.range * b.count;
        if (s > score) { score = s; idx = i; }
      }
      if (idx < 0) break; // nothing left to split
      const b = buckets[idx];
      const ch = b.channel;
      b.pixels.sort((p, q) => p[ch] - q[ch]);
      const mid = Math.floor(b.pixels.length / 2);
      buckets.splice(idx, 1,
        makeBucket(b.pixels.slice(0, mid)),
        makeBucket(b.pixels.slice(mid)));
    }
    return buckets
      .map(b => ({ color: average(b.pixels), count: b.count }))
      .sort((a, b) => b.count - a.count); // most common first
  }

  // ---- 3. ordering helpers ----
  const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  function hue([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; return h < 0 ? h + 360 : h;
  }
  const toHex = ([r, g, b]) =>
    [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");

  // ---- build WLED stops (pos 0..255) ----
  function buildStops(extracted, { order = "hue", weight = true } = {}) {
    const arr = [...extracted];
    if (order === "hue") arr.sort((a, b) => hue(a.color) - hue(b.color));
    else if (order === "brightness") arr.sort((a, b) => luminance(a.color) - luminance(b.color));
    // "popularity" -> keep count-desc order from quantize()

    const n = arr.length;
    if (n === 0) return [];
    if (n === 1) {
      const hex = toHex(arr[0].color);
      return [{ pos: 0, hex }, { pos: 255, hex }];
    }

    let positions;
    if (weight) {
      // place each stop at the CENTRE of its population band, then
      // rescale so the first band-centre -> 0 and the last -> 255.
      // A heavy (common) colour has a wide band => its neighbours sit
      // further away => that colour occupies more of the gradient.
      const total = arr.reduce((s, c) => s + c.count, 0) || 1;
      const centres = [];
      let cum = 0;
      for (const c of arr) {
        const w = c.count / total;
        centres.push(cum + w / 2);
        cum += w;
      }
      const c0 = centres[0], span = (centres[n - 1] - c0) || 1;
      positions = centres.map(c => Math.round((c - c0) / span * 255));
    } else {
      positions = arr.map((_, i) => Math.round(i / (n - 1) * 255));
    }

    // anchor endpoints (WLED requires 0 and 255) + keep strictly increasing
    positions[0] = 0;
    for (let i = 1; i < n; i++) {
      if (positions[i] <= positions[i - 1]) positions[i] = positions[i - 1] + 1;
    }
    positions[n - 1] = 255;
    if (positions[n - 2] >= 255) positions[n - 2] = 254;

    return arr.map((c, i) => ({ pos: positions[i], hex: toHex(c.color) }));
  }

  function fromImage(img, opts = {}) {
    const px = getPixels(img, opts.maxDim || 200);
    const colors = quantize(px, opts.colors || 8);
    return buildStops(colors, opts);
  }

  return { getPixels, quantize, buildStops, fromImage };
})();
