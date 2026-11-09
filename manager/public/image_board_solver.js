'use strict';

/**
 * PmheeAether Human Check Image Board Auto-Solver Module
 * Handles prompt parsing, catalog resolution, multi-scale template matching,
 * and rotation/flip/scale/hue-invariant visual frame matching for coordinate-based captcha boards.
 * Universal Module Definition (UMD) for Node.js and Browser environments.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ImageBoardSolver = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {

  function normalizePrompt(prompt) {
    if (typeof prompt !== 'string') return '';
    return prompt
      .trim()
      .toLowerCase()
      .replace(/^(?:กรุณา)?\s*(?:คลิก|กด|เลือก)\s*(?:ที่)?\s*(?:รูปภาพ|รูป|ภาพ)?\s*(?:ของ)?\s*/i, '')
      .replace(/^(?:please\s+)?(?:press|click|select|choose)\s+(?:the\s+)?(?:picture|image|icon)\s+(?:of\s+)?/i, '')
      .replace(/\s*(?:ภายในเวลา|ด่วน|ก่อนหมดเวลา).*$/i, '')
      .trim();
  }

  function resolveTargetItem(prompt, catalog) {
    if (!catalog || !Array.isArray(catalog.items)) return null;
    const target = normalizePrompt(prompt);
    if (!target) return null;

    const item = catalog.items.find(it => it && typeof it.name === 'string' && it.name.trim().toLowerCase() === target);
    if (!item) return null;

    const manifest = catalog.manifest?.items || catalog.manifest || {};
    const iconRaw = manifest[String(item.id)] || manifest[item.id] || '';
    const cleanPath = typeof iconRaw === 'string'
      ? iconRaw.replace(/^https?:\/\/[^/]+/, '').replace(/^\/?art\/icons\//, '').replace(/^\//, '').split('?')[0]
      : '';

    return {
      id: item.id,
      name: item.name,
      iconPath: cleanPath,
      iconUrl: cleanPath ? '/art/icons/' + cleanPath : ''
    };
  }

  /**
   * Match a template image on a board image using alpha-masked Normalized Mean Absolute Error.
   * @param {Object} boardData - { width, height, data: Uint8ClampedArray | Buffer }
   * @param {Object} templateData - { width, height, data: Uint8ClampedArray | Buffer }
   * @param {Object} [options] - search options (step, subsample)
   */
  function matchTemplateOnBoard(boardData, templateData, options = {}) {
    const bw = boardData.width;
    const bh = boardData.height;
    const tw = templateData.width;
    const th = templateData.height;
    const bp = boardData.data;
    const tp = templateData.data;

    if (bw < tw || bh < th) return null;

    const subsample = Math.max(1, options.subsample || 2);
    const alphaThreshold = options.alphaThreshold || 120;

    // Extract non-transparent pixels from template: [relX, relY, R, G, B]
    const mask = [];
    for (let y = 0; y < th; y += subsample) {
      for (let x = 0; x < tw; x += subsample) {
        const idx = (y * tw + x) * 4;
        if (tp[idx + 3] > alphaThreshold) {
          mask.push(x, y, tp[idx], tp[idx + 1], tp[idx + 2]);
        }
      }
    }

    const maskCount = mask.length / 5;
    if (maskCount < 8) return null;

    let bestScore = Infinity;
    let bestX = 0;
    let bestY = 0;

    // Coarse scan
    const coarseStep = Math.max(2, options.coarseStep || 4);
    const maxY = bh - th;
    const maxX = bw - tw;

    for (let by = 0; by <= maxY; by += coarseStep) {
      for (let bx = 0; bx <= maxX; bx += coarseStep) {
        let diffSum = 0;
        for (let m = 0; m < mask.length; m += 5) {
          const mx = mask[m];
          const my = mask[m + 1];
          const bIdx = ((by + my) * bw + (bx + mx)) * 4;
          diffSum += Math.abs(bp[bIdx] - mask[m + 2])
                   + Math.abs(bp[bIdx + 1] - mask[m + 3])
                   + Math.abs(bp[bIdx + 2] - mask[m + 4]);
        }
        const mae = diffSum / maskCount;
        if (mae < bestScore) {
          bestScore = mae;
          bestX = bx;
          bestY = by;
        }
      }
    }

    // Fine scan: step 1 around coarse best
    let fineBestScore = bestScore;
    let fineBestX = bestX;
    let fineBestY = bestY;
    const startY = Math.max(0, bestY - coarseStep);
    const endY = Math.min(maxY, bestY + coarseStep);
    const startX = Math.max(0, bestX - coarseStep);
    const endX = Math.min(maxX, bestX + coarseStep);

    for (let by = startY; by <= endY; by++) {
      for (let bx = startX; bx <= endX; bx++) {
        let diffSum = 0;
        for (let m = 0; m < mask.length; m += 5) {
          const mx = mask[m];
          const my = mask[m + 1];
          const bIdx = ((by + my) * bw + (bx + mx)) * 4;
          diffSum += Math.abs(bp[bIdx] - mask[m + 2])
                   + Math.abs(bp[bIdx + 1] - mask[m + 3])
                   + Math.abs(bp[bIdx + 2] - mask[m + 4]);
        }
        const mae = diffSum / maskCount;
        if (mae < fineBestScore) {
          fineBestScore = mae;
          fineBestX = bx;
          fineBestY = by;
        }
      }
    }

    // Score calibration: MAE of 0 => 100% confidence, MAE > 150 => 0% confidence
    const confidence = Math.max(0, Math.min(100, Math.round(100 - (fineBestScore / 2.5))));

    return {
      bestX: fineBestX,
      bestY: fineBestY,
      centerX: Math.round(fineBestX + tw / 2),
      centerY: Math.round(fineBestY + th / 2),
      width: tw,
      height: th,
      score: fineBestScore,
      confidence
    };
  }

  function findGoldenFrame(boardData) {
    if (!boardData || !boardData.data) return null;
    const bw = boardData.width;
    const bh = boardData.height;
    const bp = boardData.data;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let count = 0;

    for (let y = 15; y < Math.min(160, bh); y++) {
      for (let x = 120; x < Math.min(360, bw); x++) {
        const idx = (y * bw + x) * 4;
        const r = bp[idx];
        const g = bp[idx + 1];
        const b = bp[idx + 2];
        // Golden border pixel check: warm yellow (R > 150, G > 120, B < 120, R >= G - 15, R - B > 40)
        if (r > 150 && g > 120 && b < 120 && r >= g - 15 && r - b > 40) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }

    const fw = maxX - minX;
    const fh = maxY - minY;
    if (count >= 25 && fw >= 45 && fw <= 150 && fh >= 45 && fh <= 145) {
      return { x: minX, y: minY, width: fw, height: fh };
    }
    return { x: 175, y: 20, width: 130, height: 117 };
  }

  /**
   * Segment the foreground sprite inside [x1..x2, y1..y2] by removing 1-2px noise lines/stars
   * and subtracting flat background / translucent background circles, then compute its
   * rotation/flip/scale-invariant polar shape + shading descriptor.
   */
  function extractBoxObject(boardData, x1, y1, x2, y2) {
    const bw = boardData.width;
    const bh = boardData.height;
    const bp = boardData.data;
    x1 = Math.max(0, Math.min(bw - 1, Math.round(x1)));
    x2 = Math.max(x1 + 4, Math.min(bw - 1, Math.round(x2)));
    y1 = Math.max(0, Math.min(bh - 1, Math.round(y1)));
    y2 = Math.max(y1 + 4, Math.min(bh - 1, Math.round(y2)));
    const w = x2 - x1 + 1;
    const h = y2 - y1 + 1;

    const R = new Float32Array(w * h);
    const G = new Float32Array(w * h);
    const B = new Float32Array(w * h);
    const greenPts = [];
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        const i = ((y1 + ly) * bw + (x1 + lx)) * 4;
        const r = bp[i], g = bp[i + 1], b = bp[i + 2];
        R[ly * w + lx] = r;
        G[ly * w + lx] = g;
        B[ly * w + lx] = b;
        if (g > 140 && g - r > 95 && b > 85 && Math.abs(g - 185) < 55 && Math.abs(b - 129) < 55 && r < 65) {
          greenPts.push([lx, ly]);
        }
      }
    }

    // If box contains a Discord #10b981 selection circle (radius ~26), inpaint the ring pixels
    if (greenPts.length >= 25) {
      let sx = 0, sy = 0;
      for (const [gx, gy] of greenPts) { sx += gx; sy += gy; }
      const cx0 = sx / greenPts.length, cy0 = sy / greenPts.length;
      let bestCx = cx0, bestCy = cy0, bestCnt = -1;
      for (let dy = -6; dy <= 6; dy += 0.5) {
        for (let dx = -6; dx <= 6; dx += 0.5) {
          let cnt = 0;
          for (const [gx, gy] of greenPts) {
            const d = Math.hypot(gx - (cx0 + dx), gy - (cy0 + dy));
            if (d >= 24.2 && d <= 27.8) cnt++;
          }
          if (cnt > bestCnt) { bestCnt = cnt; bestCx = cx0 + dx; bestCy = cy0 + dy; }
        }
      }
      const isRing = new Uint8Array(w * h);
      for (let ly = Math.max(0, Math.floor(bestCy - 31)); ly <= Math.min(h - 1, Math.ceil(bestCy + 31)); ly++) {
        for (let lx = Math.max(0, Math.floor(bestCx - 31)); lx <= Math.min(w - 1, Math.ceil(bestCx + 31)); lx++) {
          const d = Math.hypot(lx - bestCx, ly - bestCy);
          if (d >= 23.2 && d <= 28.8) {
            const p = ly * w + lx;
            if (G[p] - R[p] > 35 && G[p] > 75 && B[p] > 55) isRing[p] = 1;
          }
        }
      }
      for (let pass = 0; pass < 4; pass++) {
        const cR = new Float32Array(R), cG = new Float32Array(G), cB = new Float32Array(B);
        for (let ly = Math.max(2, Math.floor(bestCy - 31)); ly <= Math.min(h - 3, Math.ceil(bestCy + 31)); ly++) {
          for (let lx = Math.max(2, Math.floor(bestCx - 31)); lx <= Math.min(w - 3, Math.ceil(bestCx + 31)); lx++) {
            const p = ly * w + lx;
            if (!isRing[p]) continue;
            let sr = 0, sg = 0, sb = 0, cnt = 0;
            for (let dy = -3; dy <= 3; dy++) {
              for (let dx = -3; dx <= 3; dx++) {
                const ny = ly + dy, nx = lx + dx;
                if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
                const np = ny * w + nx;
                if (!isRing[np]) {
                  sr += cR[np]; sg += cG[np]; sb += cB[np];
                  cnt++;
                }
              }
            }
            if (cnt > 0) {
              R[p] = sr / cnt; G[p] = sg / cnt; B[p] = sb / cnt;
              isRing[p] = 0;
            }
          }
        }
      }
    }

    // Clamp thin 1-2px ridges (noise curves & star dots) to surrounding background
    for (let pass = 0; pass < 2; pass++) {
      const nR = new Float32Array(R), nG = new Float32Array(G), nB = new Float32Array(B);
      const rad = pass === 0 ? 2 : 3;
      for (let ly = rad; ly < h - rad; ly++) {
        for (let lx = rad; lx < w - rad; lx++) {
          const p = ly * w + lx;
          const dirs = [
            [p - rad, p + rad],
            [p - rad * w, p + rad * w],
            [p - rad * w - rad, p + rad * w + rad],
            [p - rad * w + rad, p + rad * w - rad]
          ];
          let matchPairs = 0, sR = 0, sG = 0, sB = 0;
          for (const [p1, p2] of dirs) {
            const d12 = Math.abs(R[p1] - R[p2]) + Math.abs(G[p1] - G[p2]) + Math.abs(B[p1] - B[p2]);
            const mR = (R[p1] + R[p2]) * 0.5, mG = (G[p1] + G[p2]) * 0.5, mB = (B[p1] + B[p2]) * 0.5;
            const dC = Math.abs(R[p] - mR) + Math.abs(G[p] - mG) + Math.abs(B[p] - mB);
            if (d12 < 24 && dC > 30 && (pass === 0 || dC < 190)) {
              matchPairs++;
              sR += mR; sG += mG; sB += mB;
            }
          }
          if (matchPairs >= 2) {
            nR[p] = sR / matchPairs;
            nG[p] = sG / matchPairs;
            nB[p] = sB / matchPairs;
          }
        }
      }
      R.set(nR); G.set(nG); B.set(nB);
    }
    // Clamp 3-4px translucent white/gray scribble strokes (dR, dG, dB > 10 with low chroma delta)
    for (const rad of [3, 4, 3, 4]) {
      const nR = new Float32Array(R), nG = new Float32Array(G), nB = new Float32Array(B);
      for (let ly = rad; ly < h - rad; ly++) {
        for (let lx = rad; lx < w - rad; lx++) {
          const p = ly * w + lx;
          const dirs = [
            [p - rad, p + rad],
            [p - rad * w, p + rad * w],
            [p - rad * w - rad, p + rad * w + rad],
            [p - rad * w + rad, p + rad * w - rad]
          ];
          let scribPairs = 0, sR = 0, sG = 0, sB = 0;
          for (const [p1, p2] of dirs) {
            const d12 = Math.abs(R[p1] - R[p2]) + Math.abs(G[p1] - G[p2]) + Math.abs(B[p1] - B[p2]);
            if (d12 >= 22) continue;
            const mR = (R[p1] + R[p2]) * 0.5, mG = (G[p1] + G[p2]) * 0.5, mB = (B[p1] + B[p2]) * 0.5;
            const dR = R[p] - mR, dG = G[p] - mG, dB = B[p] - mB;
            const chromaDelta = Math.max(dR, dG, dB) - Math.min(dR, dG, dB);
            if (dR > 10 && dG > 10 && dB > 10 && dR < 85 && chromaDelta <= 16) {
              scribPairs++;
              sR += mR; sG += mG; sB += mB;
            }
          }
          if (scribPairs >= 1) {
            nR[p] = sR / scribPairs;
            nG[p] = sG / scribPairs;
            nB[p] = sB / scribPairs;
          }
        }
      }
      R.set(nR); G.set(nG); B.set(nB);
    }

    // Collect flat color clusters (3x3 local range <= 14) representing dark board & background circles
    const colorBins = new Map();
    for (let ly = 2; ly < h - 2; ly++) {
      for (let lx = 2; lx < w - 2; lx++) {
        const p = ly * w + lx;
        let maxDiff = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const np = (ly + dy) * w + (lx + dx);
            const d = Math.abs(R[p] - R[np]) + Math.abs(G[p] - G[np]) + Math.abs(B[p] - B[np]);
            if (d > maxDiff) maxDiff = d;
          }
        }
        if (maxDiff <= 15) {
          const kr = Math.round(R[p] / 8), kg = Math.round(G[p] / 8), kb = Math.round(B[p] / 8);
          const key = (kr << 12) | (kg << 6) | kb;
          let entry = colorBins.get(key);
          if (!entry) {
            entry = { count: 0, sumR: 0, sumG: 0, sumB: 0 };
            colorBins.set(key, entry);
          }
          entry.count++;
          entry.sumR += R[p];
          entry.sumG += G[p];
          entry.sumB += B[p];
        }
      }
    }

    const bgColors = [{ r: 25, g: 22, b: 37 }];
    for (const entry of colorBins.values()) {
      const mr = entry.sumR / entry.count, mg = entry.sumG / entry.count, mb = entry.sumB / entry.count;
      const sum = mr + mg + mb;
      const sat = Math.max(mr, mg, mb) - Math.min(mr, mg, mb);
      if (sum < 265 && sat < 56 && (entry.count >= 14 || (entry.count >= 5 && sum < 115))) {
        bgColors.push({ r: mr, g: mg, b: mb });
      }
    }

    const mask = new Uint8Array(w * h);
    for (let ly = 2; ly < h - 2; ly++) {
      for (let lx = 2; lx < w - 2; lx++) {
        const p = ly * w + lx;
        let minDist = Infinity;
        for (const bg of bgColors) {
          const d = Math.abs(R[p] - bg.r) + Math.abs(G[p] - bg.g) + Math.abs(B[p] - bg.b);
          if (d < minDist) minDist = d;
        }
        if (minDist > 28) {
          mask[p] = 1;
        }
      }
    }

    const eroded = new Uint8Array(w * h);
    for (let ly = 2; ly < h - 2; ly++) {
      for (let lx = 2; lx < w - 2; lx++) {
        const p = ly * w + lx;
        if (!mask[p]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            n += mask[(ly + dy) * w + (lx + dx)];
          }
        }
        if (n >= 5) eroded[p] = 1;
      }
    }

    // Fallback to un-eroded mask if object is thin (e.g. synthetic small cross)
    let activeSeed = eroded;
    let seedSum = 0;
    for (let i = 0; i < w * h; i++) seedSum += eroded[i];
    if (seedSum < 15) activeSeed = mask;

    const visited = new Uint8Array(w * h);
    const comps = [];
    for (let ly = 2; ly < h - 2; ly++) {
      for (let lx = 2; lx < w - 2; lx++) {
        const p = ly * w + lx;
        if (activeSeed[p] && !visited[p]) {
          const q = [p];
          visited[p] = 1;
          const pts = [];
          let sx = 0, sy = 0;
          while (q.length > 0) {
            const cur = q.pop();
            const cy = Math.floor(cur / w), cx = cur % w;
            pts.push([cx, cy]);
            sx += cx; sy += cy;
            for (let dy = -3; dy <= 3; dy++) {
              for (let dx = -3; dx <= 3; dx++) {
                const ny = cy + dy, nx = cx + dx;
                if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
                  const np = ny * w + nx;
                  if (activeSeed[np] && !visited[np]) {
                    visited[np] = 1;
                    q.push(np);
                  }
                }
              }
            }
          }
          if (pts.length >= 12) {
            comps.push({ pts, count: pts.length, cx: sx / pts.length, cy: sy / pts.length });
          }
        }
      }
    }
    comps.sort((a, b) => b.count - a.count);
    if (!comps.length) return null;

    const finalMask = new Uint8Array(w * h);
    const main = comps[0];
    const validPts = [];
    for (const c of comps) {
      const distMain = Math.hypot(c.cx - main.cx, c.cy - main.cy);
      const inInterior = c.cx >= 16 && c.cx <= w - 16 && c.cy >= 16 && c.cy <= h - 16;
      const isBowPart = inInterior && ((main.count <= 900 && c.count >= 135 && distMain <= 50) || (main.count < 180 && c.count >= 65 && distMain <= 40));
      if (c === main || (c.count >= 25 && distMain <= 32) || isBowPart) {
        for (const [px, py] of c.pts) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const ny = py + dy, nx = px + dx;
              if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
                const np = ny * w + nx;
                if (mask[np] && !finalMask[np]) {
                  finalMask[np] = 1;
                  validPts.push([nx, ny]);
                }
              }
            }
          }
        }
      }
    }
    if (validPts.length < 10) return null;

    const grad = new Float32Array(w * h);
    for (let ly = 1; ly < h - 1; ly++) {
      for (let lx = 1; lx < w - 1; lx++) {
        const p = ly * w + lx;
        grad[p] = Math.abs(R[p + 1] - R[p - 1]) + Math.abs(G[p + 1] - G[p - 1]) + Math.abs(B[p + 1] - B[p - 1])
                + Math.abs(R[p + w] - R[p - w]) + Math.abs(G[p + w] - G[p - w]) + Math.abs(B[p + w] - B[p - w]);
      }
    }

    // Prune scribble lines by computing core mask (pixels with >=6 neighbors in 3x3 or >=14 in 5x5)
    const coreMask = new Uint8Array(w * h);
    for (let ly = 2; ly < h - 2; ly++) {
      for (let lx = 2; lx < w - 2; lx++) {
        const p = ly * w + lx;
        if (!finalMask[p]) continue;
        let nb3 = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (finalMask[(ly + dy) * w + (lx + dx)]) nb3++;
          }
        }
        let nb5 = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (finalMask[(ly + dy) * w + (lx + dx)]) nb5++;
          }
        }
        if (nb3 >= 6 || nb5 >= 14) coreMask[p] = 1;
      }
    }
    const corePts = [];
    for (let ly = 2; ly < h - 2; ly++) {
      for (let lx = 2; lx < w - 2; lx++) {
        const p = ly * w + lx;
        if (!finalMask[p]) continue;
        let nearCore = false;
        for (let dy = -2; dy <= 2 && !nearCore; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (coreMask[(ly + dy) * w + (lx + dx)]) { nearCore = true; break; }
          }
        }
        if (nearCore) corePts.push([lx, ly]);
      }
    }
    if (corePts.length >= 80 && corePts.length >= validPts.length * 0.50) {
      finalMask.fill(0);
      validPts.length = 0;
      for (const pt of corePts) {
        finalMask[pt[1] * w + pt[0]] = 1;
        validPts.push(pt);
      }
    }

    let cx = 0, cy = 0, lumSum = 0, lumSqSum = 0, satSum = 0;
    let sumR = 0, sumG = 0, sumB = 0;
    const colorHist = new Float32Array(8);
    for (const [px, py] of validPts) {
      cx += px;
      cy += py;
      const p = py * w + px;
      const r = R[p], g = G[p], b = B[p];
      sumR += r; sumG += g; sumB += b;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      lumSum += l;
      lumSqSum += l * l;
      satSum += sat;
      if (sat < 22) {
        if (l > 95) colorHist[0]++;
        else colorHist[1]++;
      } else if (b > r + 15 && b >= g) {
        colorHist[2]++;
      } else if (b > g + 4 && r > g + 2) {
        colorHist[3]++;
      } else if (r - g > 42 && r > b + 35) {
        colorHist[4]++;
      } else if (r > g + 5 && r > b + 50 && g > b + 30) {
        colorHist[5]++;
      } else if (r >= g && g >= b) {
        colorHist[6]++;
      } else {
        colorHist[7]++;
      }
    }
    for (let i = 0; i < 8; i++) colorHist[i] /= validPts.length;
    cx /= validPts.length;
    cy /= validPts.length;
    const meanLum = lumSum / validPts.length;
    const stdLum = Math.max(10, Math.sqrt(Math.max(0, lumSqSum / validPts.length - meanLum * meanLum)));
    const meanSat = satSum / validPts.length;
    const meanR = sumR / validPts.length;
    const meanG = sumG / validPts.length;
    const meanB = sumB / validPts.length;

    let m20 = 0, m02 = 0, m11 = 0, r2Sum = 0;
    for (const [px, py] of validPts) {
      const dx = px - cx, dy = py - cy;
      m20 += dx * dx;
      m02 += dy * dy;
      m11 += dx * dy;
      r2Sum += dx * dx + dy * dy;
    }
    m20 /= validPts.length;
    m02 /= validPts.length;
    m11 /= validPts.length;
    const rmsRadius = Math.max(2, Math.sqrt(r2Sum / validPts.length));
    const trace = m20 + m02;
    const det = Math.sqrt((m20 - m02) * (m20 - m02) + 4 * m11 * m11);
    const l1 = Math.max(1, (trace + det) * 0.5);
    const l2 = Math.max(1, (trace - det) * 0.5);
    const elongation = Math.sqrt(l1 / l2);
    const fillRatio = validPts.length / (rmsRadius * rmsRadius);

    const NR = 12, NA = 36;
    const polarMask = new Float32Array(NR * NA);
    const polarLum = new Float32Array(NR * NA);
    const polarGrad = new Float32Array(NR * NA);

    for (let rIdx = 0; rIdx < NR; rIdx++) {
      const rNorm = 0.15 + (rIdx / (NR - 1)) * 1.9;
      const rad = rNorm * rmsRadius;
      for (let aIdx = 0; aIdx < NA; aIdx++) {
        const ang = (aIdx * 2 * Math.PI) / NA;
        const px = Math.round(cx + rad * Math.cos(ang));
        const py = Math.round(cy + rad * Math.sin(ang));
        let mVal = 0, lVal = 0, gVal = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const sx = px + dx, sy = py + dy;
            if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
              const p = sy * w + sx;
              const m = finalMask[p];
              mVal += m;
              if (m) {
                const l = 0.299 * R[p] + 0.587 * G[p] + 0.114 * B[p];
                lVal += (l - meanLum) / stdLum;
                gVal += grad[p] / 100;
              }
              cnt++;
            }
          }
        }
        if (cnt > 0) {
          polarMask[rIdx * NA + aIdx] = mVal / cnt;
          polarLum[rIdx * NA + aIdx] = mVal > 0 ? lVal / mVal : 0;
          polarGrad[rIdx * NA + aIdx] = mVal > 0 ? gVal / mVal : 0;
        }
      }
    }

    return {
      cx: cx + x1,
      cy: cy + y1,
      x: Math.round(cx + x1),
      y: Math.round(cy + y1),
      area: validPts.length,
      rmsRadius,
      elongation,
      fillRatio,
      meanLum,
      stdLum,
      meanSat,
      meanR,
      meanG,
      meanB,
      colorHist,
      polarMask,
      polarLum,
      polarGrad
    };
  }

  function compareObjects(top, slot) {
    const NR = 12, NA = 36;
    let bestPolarDist = Infinity;

    for (const mirror of [1, -1]) {
      for (let shift = 0; shift < NA; shift++) {
        let maskDiff = 0;
        let lumDiff = 0;
        let gradDiff = 0;
        let overlapWeight = 0;
        let unionWeight = 0;
        for (let rIdx = 0; rIdx < NR; rIdx++) {
          const rw = 0.5 + 0.5 * Math.sin((rIdx / (NR - 1)) * Math.PI);
          for (let aIdx = 0; aIdx < NA; aIdx++) {
            const bA = ((mirror * aIdx + shift) % NA + NA) % NA;
            const idxA = rIdx * NA + aIdx;
            const idxB = rIdx * NA + bA;
            const mA = top.polarMask[idxA];
            const mB = slot.polarMask[idxB];
            maskDiff += rw * Math.abs(mA - mB);
            unionWeight += rw * Math.max(mA, mB);
            const minM = Math.min(mA, mB);
            if (minM > 0.1) {
              overlapWeight += minM;
              lumDiff += minM * Math.abs(top.polarLum[idxA] - slot.polarLum[idxB]);
              gradDiff += minM * Math.abs(top.polarGrad[idxA] - slot.polarGrad[idxB]);
            }
          }
        }
        const normMask = maskDiff / Math.max(1, unionWeight);
        const normLum = overlapWeight > 1 ? lumDiff / overlapWeight : 2.0;
        const normGrad = overlapWeight > 1 ? gradDiff / overlapWeight : 1.0;
        const dist = normMask * 2.6 + normLum * 0.65 + normGrad * 0.30;
        if (dist < bestPolarDist) bestPolarDist = dist;
      }
    }

    const rawElongDiff = Math.abs(Math.log(top.elongation / slot.elongation));
    const rawFillDiff = Math.abs(Math.log(top.fillRatio / slot.fillRatio));
    const maxEl = Math.max(top.elongation, slot.elongation), minEl = Math.min(top.elongation, slot.elongation);
    const maxFl = Math.max(top.fillRatio, slot.fillRatio), minFl = Math.min(top.fillRatio, slot.fillRatio);
    const ultraElongatedPair = maxEl >= 6.0 && (
      (minEl >= 2.15 && maxFl <= 2.35 && !(minFl <= 0.95 && maxFl >= 1.80)) ||
      (minEl >= 1.85 && maxFl <= 1.45)
    );
    const elongDiff = (ultraElongatedPair ? Math.min(0.28, rawElongDiff * 0.45) : rawElongDiff) * 0.95;
    const fillDiff = (ultraElongatedPair ? Math.min(0.25, rawFillDiff * 0.55) : rawFillDiff) * 0.95;
    const scaleRatio = slot.rmsRadius / top.rmsRadius;
    const scalePenalty = (scaleRatio < 0.48 || scaleRatio > 1.20)
      ? Math.abs(Math.log(scaleRatio)) * 0.85
      : Math.abs(Math.log(scaleRatio / 0.88)) * 0.12;
    const areaRatio = slot.area / (top.area * 0.85);
    const areaPenalty = Math.abs(Math.log(Math.max(0.35, Math.min(3.5, areaRatio)))) * 0.06;
    const lumStatPenalty = (Math.abs(top.meanLum - slot.meanLum) / 110 + Math.abs(top.stdLum - slot.stdLum) / 85 + Math.abs(top.meanSat - slot.meanSat) / 48) * 0.50;
    const rgbDiff = (Math.abs(top.meanR - slot.meanR) + Math.abs(top.meanG - slot.meanG) + Math.abs(top.meanB - slot.meanB));
    const topRG = top.meanR - top.meanG, slotRG = slot.meanR - slot.meanG;
    const topGB = top.meanG - top.meanB, slotGB = slot.meanG - slot.meanB;
    const chromaDiff = Math.abs(topRG - slotRG) + Math.abs(topGB - slotGB);
    let histDiff = 0;
    let structColorPenalty = 0;
    if (top.colorHist && slot.colorHist) {
      for (let i = 0; i < 8; i++) histDiff += Math.abs(top.colorHist[i] - slot.colorHist[i]);
      histDiff = histDiff - Math.abs(top.colorHist[4] - slot.colorHist[4]) - Math.abs(top.colorHist[5] - slot.colorHist[5])
        + Math.abs((top.colorHist[4] + top.colorHist[5]) - (slot.colorHist[4] + slot.colorHist[5])) * 0.85
        + (Math.abs(top.colorHist[4] - slot.colorHist[4]) + Math.abs(top.colorHist[5] - slot.colorHist[5])) * 0.35;

      // Blue-dominant pair: distinguish corked Blue Potion (warm >= 0.06) from corkless Butterfly Wing (warm <= 0.015)
      if (top.colorHist[2] >= 0.45 && slot.colorHist[2] >= 0.45) {
        const topWarm = top.colorHist[4] + top.colorHist[5] + top.colorHist[6];
        const slotWarm = slot.colorHist[4] + slot.colorHist[5] + slot.colorHist[6];
        if ((topWarm >= 0.06 && slotWarm <= 0.015) || (slotWarm >= 0.06 && topWarm <= 0.015)) {
          structColorPenalty += 1.45;
        }
      }
      // Metallic gray blade/mace (sat <= 23.5, achromatic >= 0.60, bright silver >= 0.38) vs warm wooden item (Bow/Arrows/Wand)
      const topGray = top.colorHist[0] + top.colorHist[1], slotGray = slot.colorHist[0] + slot.colorHist[1];
      const topWarmAll = top.colorHist[4] + top.colorHist[5] + top.colorHist[6], slotWarmAll = slot.colorHist[4] + slot.colorHist[5] + slot.colorHist[6];
      const isDaggerLike = (o, oGray, oWarm) => o.meanSat <= 23.5 && oGray >= 0.60 && o.colorHist[0] >= 0.38 && oWarm <= 0.30;
      const isWoodLike = (o, oGray, oWarm) => (o.meanSat >= 30 && oGray <= 0.40 && (oWarm >= 0.42 || o.colorHist[2] >= 0.06)) || (o.meanSat >= 24 && oWarm >= 0.45 && o.colorHist[0] <= 0.34);
      if ((isDaggerLike(slot, slotGray, slotWarmAll) && (isWoodLike(top, topGray, topWarmAll) || (top.elongation <= 1.65 && slot.elongation >= 3.2))) ||
          (isDaggerLike(top, topGray, topWarmAll) && (isWoodLike(slot, slotGray, slotWarmAll) || (slot.elongation <= 1.65 && top.elongation >= 3.2)))) {
        structColorPenalty += 0.75;
      }
      // Large round Ring (area >= 2400, elong <= 1.24, low white rim <= 0.06) vs small elongated glass Red Potion (area < 0.55*ref, white rim >= 0.10)
      const isLargeRingLike = o => o.area >= 2400 && o.elongation <= 1.24 && o.colorHist[0] <= 0.06;
      const isSmallBottleLike = (o, ref) => o.area < ref.area * 0.55 && o.rmsRadius < ref.rmsRadius * 0.72 && o.colorHist[0] >= 0.10 && o.elongation >= 1.30;
      if ((isLargeRingLike(top) && isSmallBottleLike(slot, top)) || (isLargeRingLike(slot) && isSmallBottleLike(top, slot))) {
        structColorPenalty += 0.75;
      }
      // Royal Crown (solid round, white ermine fur >= 0.15) vs Smoking Pipe or Sunflower Hairpin (white <= 0.06)
      const isCrownLike = o => o.area >= 2600 && o.elongation <= 1.16 && o.fillRatio >= 5.75 && o.colorHist[0] >= 0.15 && o.meanSat >= 50 && o.meanSat <= 78;
      const isPipeOrHairpinLike = o => (o.area <= 1550 && o.elongation >= 1.32 && o.colorHist[0] <= 0.06 && (o.colorHist[4] + o.colorHist[5] + o.colorHist[6]) >= 0.65) || (o.meanSat >= 82 && o.colorHist[0] <= 0.04 && o.colorHist[7] >= 0.15);
      if ((isCrownLike(top) && isPipeOrHairpinLike(slot)) || (isCrownLike(slot) && isPipeOrHairpinLike(top))) {
        structColorPenalty += 1.10;
      }
      // Steampunk Goggles (cyan/blue lenses: hist[2]>=0.09, hist[7]>=0.15, sum>=0.26) vs Smoking Pipe / Binoculars (hist[7]<=0.06, warm>=0.68)
      const isGogglesLike = o => o.colorHist[2] >= 0.09 && o.colorHist[7] >= 0.15 && (o.colorHist[2] + o.colorHist[7]) >= 0.26;
      const isWarmNoTeal = o => o.colorHist[7] <= 0.06 && (o.colorHist[4] + o.colorHist[5] + o.colorHist[6]) >= 0.68;
      if ((isGogglesLike(top) && isWarmNoTeal(slot)) || (isGogglesLike(slot) && isWarmNoTeal(top))) {
        structColorPenalty += 0.65;
      }
      // White Opal (bright oval, lum>=170, hist[0]>=0.52, el>=1.16) vs Round Metal Shield (circular, lum<=162, el<=1.12, hist[7]>=0.14)
      const isOpalLike = o => o.meanLum >= 170 && o.colorHist[0] >= 0.52 && o.elongation >= 1.16 && o.colorHist[7] <= 0.09;
      const isRoundShieldLike = o => o.meanLum <= 162 && o.elongation <= 1.12 && o.colorHist[7] >= 0.14;
      if ((isOpalLike(top) && isRoundShieldLike(slot)) || (isOpalLike(slot) && isRoundShieldLike(top))) {
        structColorPenalty += 0.55;
      }
    }
    const rgbPenalty = (rgbDiff / 220) * 0.35 + (chromaDiff / 90) * 0.40 + histDiff * 0.62 + structColorPenalty;

    const totalScore = bestPolarDist + elongDiff + fillDiff + scalePenalty + areaPenalty + lumStatPenalty + rgbPenalty;
    return { totalScore, bestPolarDist, elongDiff, fillDiff, scalePenalty, areaPenalty, lumStatPenalty, rgbPenalty, histDiff };
  }

  /**
   * Locate the 4 candidate items at the bottom of the 480x330 captcha board (left to right: slot 1..4).
   */
  function findBottomCandidates(boardData) {
    if (!boardData || !boardData.data) return [];
    const bw = boardData.width || 480;
    const rawBh = boardData.height || 330;
    const bh = (bw === 480 && rawBh === 368) ? 330 : rawBh;
    const sx = bw / 480;
    const sy = bh / 330;
    const rawCols = [
      [15, 120],
      [130, 232],
      [248, 355],
      [365, 468]
    ];
    const y1 = Math.round(175 * sy);
    const y2 = Math.min(bh - 5, Math.round(306 * sy));

    return rawCols.map(([cx1, cx2], idx) => {
      const x1 = Math.round(cx1 * sx);
      const x2 = Math.round(cx2 * sx);
      const obj = extractBoxObject(boardData, x1, y1, x2, y2);
      if (obj) {
        return {
          slot: idx + 1,
          x: obj.x,
          y: obj.y,
          centerX: obj.x,
          centerY: obj.y,
          area: obj.area,
          obj
        };
      }
      const fallbackX = Math.round(((cx1 + cx2) * 0.5) * sx);
      const fallbackY = Math.round(240 * sy);
      return {
        slot: idx + 1,
        x: fallbackX,
        y: fallbackY,
        centerX: fallbackX,
        centerY: fallbackY,
        area: 0,
        obj: null
      };
    });
  }

  function solveFrameChallenge(boardData, options = {}) {
    if (!boardData || !boardData.data) return null;
    const frame = findGoldenFrame(boardData);
    if (!frame) return null;

    const insetX = frame.width >= 100 ? 11 : 8;
    const insetY = frame.height >= 100 ? 9 : 8;
    const fx1 = frame.x + insetX;
    const fy1 = frame.y + insetY;
    const fx2 = frame.x + frame.width - insetX;
    const fy2 = frame.y + frame.height - insetY;

    const topObj = extractBoxObject(boardData, fx1, fy1, fx2, fy2);
    const candidates = findBottomCandidates(boardData);
    const validCandidates = candidates.filter(c => c.obj !== null);

    if (topObj && validCandidates.length > 0) {
      const scored = validCandidates.map(c => {
        const cmp = compareObjects(topObj, c.obj);
        return {
          ...c,
          score: cmp.totalScore,
          cmp
        };
      });
      scored.sort((a, b) => a.score - b.score);
      const excludeRaw = options && options.excludeSlots;
      const excludeSet = excludeRaw instanceof Set
        ? excludeRaw
        : new Set(Array.isArray(excludeRaw) ? excludeRaw.map(Number) : []);
      const available = excludeSet.size > 0 ? scored.filter(s => !excludeSet.has(s.slot)) : scored;
      const best = available[0] || scored[0];
      const runnerUp = available.length > 1 ? available[1] : (scored.find(s => s !== best) || null);
      const secondScore = runnerUp ? runnerUp.score : best.score + 1.5;
      const margin = Math.max(0, secondScore - best.score);

      // Calibrate confidence (0..100) from best.score and margin over runner-up
      const rawConf = 100 - Math.max(0, best.score - 0.5) * 14 + Math.min(18, margin * 18);
      const confidence = Math.max(40, Math.min(99, Math.round(rawConf)));

      return {
        targetX: best.x,
        targetY: best.y,
        centerX: best.x,
        centerY: best.y,
        x: best.x,
        y: best.y,
        slot: best.slot,
        mae: best.score,
        score: best.score,
        margin,
        confidence,
        frame,
        candidates: candidates.map(c => ({ slot: c.slot, x: c.x, y: c.y })),
        ranked: scored.map(s => ({ slot: s.slot, x: s.x, y: s.y, score: s.score })),
        matchedName: `รูปในกรอบ (ช่องที่ ${best.slot})`
      };
    }

    return null;
  }

  function extractWarmClubObject(boardData, x1, y1, x2, y2) {
    const bw = boardData.width || 480;
    const bp = boardData.data;
    const ix1 = Math.max(0, Math.round(x1)), iy1 = Math.max(0, Math.round(y1));
    const ix2 = Math.min(bw, Math.round(x2)), iy2 = Math.min(boardData.height || 330, Math.round(y2));
    const w = ix2 - ix1, h = iy2 - iy1;
    if (w < 8 || h < 8) return null;
    const sub = new Uint8ClampedArray(w * h * 4);
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        const si = ((iy1 + ly) * bw + (ix1 + lx)) * 4;
        const di = (ly * w + lx) * 4;
        const r = bp[si], g = bp[si + 1], b = bp[si + 2];
        if (b >= g + 8 && r < 110) {
          sub[di] = 28; sub[di + 1] = 25; sub[di + 2] = 35; sub[di + 3] = 255;
        } else {
          sub[di] = r; sub[di + 1] = g; sub[di + 2] = b; sub[di + 3] = 255;
        }
      }
    }
    const obj = extractBoxObject({ width: w, height: h, data: sub }, 0, 0, w, h);
    if (!obj) return null;
    obj.cx += ix1; obj.cy += iy1; obj.x += ix1; obj.y += iy1;
    return obj;
  }

  /**
   * Auto-solve Count Challenge ("ในรูปมีของแบบในกรอบกี่อัน").
   * Returns { count: 1..6, confidence, items, scores }.
   */
  function solveCountChallenge(boardData, options = {}) {
    if (!boardData || !boardData.data) return null;
    const bw = boardData.width || 480;
    const rawBh = boardData.height || 330;
    const bh = (bw === 480 && (rawBh === 368 || rawBh === 398)) ? (rawBh - 38) : rawBh;
    let bp = boardData.data;

    // Inpaint green annotation ring (and optional dark-green numbered badge) if evaluating an annotated Discord screenshot
    const isRing = new Uint8Array(bw * bh);
    const isBadge = new Uint8Array(bw * bh);
    let ringCount = 0;
    const ringPts = [];
    for (let y = 75; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const p = y * bw + x;
        const i = p * 4;
        const r = bp[i], g = bp[i + 1], b = bp[i + 2];
        if (r < 45 && g > 140 && b > 90 && b < 170) {
          isRing[p] = 1;
          ringCount++;
          if (r < 40 && g > 155 && b > 100 && b < 160 && (g - r) > 120) {
            ringPts.push([x, y]);
          }
        }
      }
    }
    if (ringCount >= 40) {
      let hasBadges = false;
      if (ringPts.length >= 30) {
        const acc = new Uint16Array(bw * bh);
        for (const [rx, ry] of ringPts) {
          for (let a = 0; a < 36; a++) {
            const ang = (a * 10 * Math.PI) / 180;
            const cx = Math.round(rx - 24 * Math.cos(ang));
            const cy = Math.round(ry - 24 * Math.sin(ang));
            if (cx >= 0 && cx < bw && cy >= 75 && cy < bh) acc[cy * bw + cx]++;
          }
        }
        const circles = [];
        for (let y = 75; y < bh; y++) {
          for (let x = 0; x < bw; x++) {
            if (acc[y * bw + x] >= 12) circles.push({ x, y, v: acc[y * bw + x] });
          }
        }
        circles.sort((a, b) => b.v - a.v);
        const uniq = [];
        for (const c of circles) {
          if (!uniq.some(u => Math.hypot(u.x - c.x, u.y - c.y) < 25)) uniq.push(c);
        }
        for (const c of uniq) {
          const bx = c.x + 18, by = c.y - 18;
          let badgeGreen = 0;
          for (let dy = -9; dy <= 9; dy += 2) {
            for (let dx = -9; dx <= 9; dx += 2) {
              const ny = by + dy, nx = bx + dx;
              if (ny >= 75 && ny < bh && nx >= 0 && nx < bw) {
                const i = (ny * bw + nx) * 4;
                const r = bp[i], g = bp[i + 1], b = bp[i + 2];
                if (r < 35 && g >= 65 && g <= 125 && b >= 45 && b <= 95 && g > r + 40) badgeGreen++;
              }
            }
          }
          if (badgeGreen >= 6) {
            hasBadges = true;
            for (let dy = -12; dy <= 12; dy++) {
              for (let dx = -12; dx <= 12; dx++) {
                if (dx * dx + dy * dy <= 11.8 * 11.8) {
                  const ny = by + dy, nx = bx + dx;
                  if (ny >= 75 && ny < bh && nx >= 0 && nx < bw) {
                    isRing[ny * bw + nx] = 1;
                    isBadge[ny * bw + nx] = 1;
                  }
                }
              }
            }
            for (let dy = -28; dy <= 28; dy++) {
              for (let dx = -28; dx <= 28; dx++) {
                const ny = c.y + dy, nx = c.x + dx;
                if (ny < 75 || ny >= bh || nx < 0 || nx >= bw) continue;
                const dist = Math.hypot(dx, dy);
                if (dist >= 20.5 && dist <= 27.5) {
                  const p = ny * bw + nx;
                  const i = p * 4;
                  const r = bp[i], g = bp[i + 1], b = bp[i + 2];
                  if ((g > r + 18 && b > r + 8) || (dist >= 22.0 && dist <= 26.0 && g > r + 8)) {
                    isRing[p] = 1;
                  }
                }
              }
            }
          }
        }
      }

      bp = new Uint8ClampedArray(boardData.data);
      const maxPasses = hasBadges ? 14 : 3;
      for (let pass = 0; pass < maxPasses; pass++) {
        const cData = new Uint8ClampedArray(bp);
        const nextMask = new Uint8Array(isRing);
        let rem = 0;
        for (let y = 76; y < bh - 1; y++) {
          for (let x = 1; x < bw - 1; x++) {
            const p = y * bw + x;
            if (!isRing[p]) continue;
            let sr = 0, sg = 0, sb = 0, cnt = 0;
            let bSr = 0, bSg = 0, bSb = 0, bCnt = 0;
            for (let dy = -2; dy <= 2; dy++) {
              for (let dx = -2; dx <= 2; dx++) {
                const np = (y + dy) * bw + (x + dx);
                if (!isRing[np]) {
                  const nr = cData[np * 4], ng = cData[np * 4 + 1], nb = cData[np * 4 + 2];
                  sr += nr; sg += ng; sb += nb; cnt++;
                  const sat = Math.max(nr, ng, nb) - Math.min(nr, ng, nb);
                  if (!(nr + ng + nb >= 175 && sat <= 24)) {
                    bSr += nr; bSg += ng; bSb += nb; bCnt++;
                  }
                }
              }
            }
            if (isBadge[p] && bCnt > 0) {
              bp[p * 4] = Math.round(bSr / bCnt);
              bp[p * 4 + 1] = Math.round(bSg / bCnt);
              bp[p * 4 + 2] = Math.round(bSb / bCnt);
              nextMask[p] = 0;
            } else if (cnt > 0) {
              bp[p * 4] = Math.round(sr / cnt);
              bp[p * 4 + 1] = Math.round(sg / cnt);
              bp[p * 4 + 2] = Math.round(sb / cnt);
              nextMask[p] = 0;
            } else {
              rem++;
            }
          }
        }
        isRing.set(nextMask);
        if (rem === 0) break;
      }
    }

    const topObj = extractBoxObject({ width: bw, height: bh, data: bp }, 204, 11, 276, 68);
    if (!topObj || topObj.area < 40) return { count: 1, confidence: 30, items: [], scores: [] };

    const topGray = topObj.colorHist[0] + topObj.colorHist[1];
    const topWood = topObj.colorHist[4] + topObj.colorHist[5] + topObj.colorHist[6];
    const topR45 = topObj.colorHist[4] + topObj.colorHist[5];
    const isTopClub = topWood >= 0.65 && topGray <= 0.18 && topObj.elongation >= 4.4 && topObj.rmsRadius >= 16.8;
    const isTopHammer = topGray >= 0.35 && topWood >= 0.15 && topObj.meanSat <= 31 && topObj.meanLum <= 105 && topR45 <= 0.15 && topObj.colorHist[5] <= 0.04;
    const isTopAxe = !isTopHammer && topGray >= 0.30 && topGray <= 0.53 && topWood >= 0.45 && topR45 >= 0.18 && topObj.elongation >= 2.95;
    const isTopWhip = topGray <= 0.16 && (topWood >= 0.70 || (topObj.colorHist[3] + topObj.colorHist[7]) >= 0.40) && topR45 <= 0.12 && topObj.meanLum <= 60 && topObj.elongation >= 1.50 && topObj.elongation <= 2.3 && topObj.fillRatio <= 3.55;
    const isTopBoots = !isTopWhip && topWood >= 0.70 && topGray <= 0.22 && topR45 <= 0.22 && topObj.elongation >= 1.30 && topObj.elongation <= 1.65 && topObj.meanLum >= 54 && topObj.fillRatio >= 3.65;
    const isTopBook = topObj.area >= 1320 && topObj.elongation <= 1.48 && topGray <= 0.22 && topWood <= 0.35;
    const isTopKatar = !isTopAxe && topObj.colorHist[0] >= 0.19 && topObj.colorHist[5] >= 0.18 && topObj.meanLum >= 95 && topObj.elongation >= 1.95 && topObj.elongation <= 2.85 && topObj.fillRatio >= 2.65;
    const isTopSpear = topObj.elongation >= 5.8 && topObj.rmsRadius <= 14.55 && topObj.area <= 290 && topObj.fillRatio <= 1.42;
    const isTopNecklace = topGray <= 0.08 && topWood >= 0.85 && topObj.colorHist[4] >= 0.24 && topObj.colorHist[5] >= 0.15 && topObj.meanSat >= 60 && topObj.area >= 450 && topObj.area <= 650 && topObj.elongation <= 1.85;
    const isTopHat = (topObj.colorHist[2] + topObj.colorHist[3]) >= 0.25 && topObj.area >= 650 && topObj.area <= 1050 && topObj.elongation <= 1.85 && topObj.meanSat <= 50;

    const bW = Math.max(54, Math.min(68, Math.round(topObj.rmsRadius * 3.2))), bH = bW;
    const step = 7;
    const candidates = [];

    function evalObj(obj, x, y, isWarmRec) {
      if (!obj || obj.cy < 82 || obj.area < Math.max(40, topObj.area * 0.22) || obj.area > topObj.area * 2.4) return;
      const areaRatio = obj.area / topObj.area;
      const areaPenalty = Math.abs(Math.log(Math.max(0.35, Math.min(2.8, areaRatio)))) * 0.9;
      const rmsRatio = obj.rmsRadius / topObj.rmsRadius;
      const rmsPenalty = Math.abs(Math.log(Math.max(0.4, Math.min(2.5, rmsRatio)))) * 0.9;

      const slotGray = obj.colorHist[0] + obj.colorHist[1];
      const slotWood = obj.colorHist[4] + obj.colorHist[5] + obj.colorHist[6];
      const slotR45 = obj.colorHist[4] + obj.colorHist[5];

      let itemPenalty = 0;
      if (!isTopClub && !isTopWhip && slotWood >= 0.65 && slotGray <= 0.12 && obj.elongation >= 2.2 && (topGray >= 0.10 || topWood <= 0.60)) {
        itemPenalty = 1.30;
      } else if (isTopClub) {
        if (obj.area < 310 || obj.area < topObj.area * 0.45 || obj.elongation < 2.4 || slotGray >= 0.34 || (obj.colorHist[4] < 0.02 && (obj.colorHist[6] >= 0.62 || obj.colorHist[5] >= 0.20) && obj.meanLum < 73) || (topObj.elongation < 4.7 && obj.area < 420)) {
          itemPenalty = 1.30;
        } else {
          let isHalfBootSlice = false;
          let rec = null;
          if (Math.hypot(obj.cx - x, obj.cy - y) >= 13) {
            rec = extractBoxObject({ width: bw, height: bh, data: bp }, obj.cx - bW / 2, obj.cy - bH / 2, obj.cx + bW / 2, obj.cy + bH / 2);
            if (rec) {
              if (rec.area >= obj.area * 1.45 && rec.elongation >= 1.425 && rec.elongation <= 2.15 && rec.fillRatio >= 2.7) {
                isHalfBootSlice = true;
              } else if (rec.area >= 780 && rec.elongation <= 2.20 && rec.fillRatio >= 3.40) {
                isHalfBootSlice = true;
              } else if (rec.area >= obj.area * 1.50 && rec.elongation <= 1.65 && obj.colorHist[5] <= 0.05 && obj.colorHist[6] >= 0.70 && obj.meanLum < 72) {
                isHalfBootSlice = true;
              }
            }
          }
          if (isHalfBootSlice) {
            itemPenalty = 1.30;
          } else if (((slotWood >= 0.58 && slotGray <= 0.26) || (rec && rec.elongation >= 2.25 && rec.fillRatio <= 2.95 && slotGray <= 0.28 && obj.colorHist[4] >= 0.10)) && obj.elongation >= 2.7 && (obj.rmsRadius < topObj.rmsRadius * 0.85 || isWarmRec)) {
            itemPenalty = (topGray < 0.05 && obj.colorHist[4] >= 0.20) ? -0.85 : -0.75;
          }
        }
      } else if (isTopHammer) {
        if (obj.meanSat >= 35 || slotGray <= 0.24 || obj.elongation >= 6.8 || obj.meanLum >= 104 || obj.colorHist[5] >= 0.18) itemPenalty = 1.10;
        else if (slotGray >= 0.45 && slotWood >= 0.16 && obj.meanSat >= 15 && obj.meanSat <= 32 && obj.meanLum <= 105 && obj.elongation <= 4.4) itemPenalty = -0.65;
        else if (topGray < 0.45 && slotGray >= 0.25 && slotWood >= 0.20 && obj.meanSat <= 34 && obj.meanLum <= 96 && obj.colorHist[5] <= 0.10) itemPenalty = -0.45;
      } else if (isTopAxe) {
        if (slotGray >= 0.50 && obj.meanSat <= 30 && slotR45 <= 0.12) itemPenalty = 0.85;
        else if (slotWood >= 0.70 && slotGray <= 0.12) itemPenalty = 1.10;
      } else if (isTopWhip) {
        if (slotGray >= 0.35 || obj.elongation >= 2.6 || obj.meanLum >= 66 || obj.colorHist[5] >= 0.11) itemPenalty = 1.00;
        else if (obj.meanLum <= 58 && obj.fillRatio <= 3.55 && slotGray <= 0.16) itemPenalty = -0.50;
      } else if (isTopBoots) {
        if (obj.elongation >= 2.4 || obj.elongation <= 1.21 || obj.meanLum <= 55 || slotWood <= 0.45 || obj.colorHist[3] >= 0.08 || (slotGray >= 0.45 && obj.meanSat <= 28)) itemPenalty = 0.90;
        else if (slotWood >= 0.50 && slotGray <= 0.39 && slotR45 <= 0.18 && obj.elongation <= 1.85 && obj.meanLum >= 50 && obj.meanLum <= 92 && obj.rmsRadius >= 14.8) itemPenalty = -0.55;
      } else if (isTopBook) {
        if (slotGray >= 0.28 || slotWood >= 0.65) itemPenalty = 0.90;
      } else if (isTopKatar) {
        if (slotGray < 0.22 || slotGray > 0.57 || slotWood < 0.36 || slotWood > 0.80 || obj.meanSat < 32 || obj.meanSat > 58 || obj.fillRatio < 2.75 || obj.fillRatio > 3.90 || obj.elongation < 1.55 || obj.colorHist[0] < 0.14 || obj.meanLum < 86 || (obj.colorHist[4] >= 0.18 && obj.colorHist[5] <= 0.07)) itemPenalty = 1.00;
        else if (slotGray >= 0.22 && slotGray <= 0.45 && obj.colorHist[0] >= 0.18 && (obj.colorHist[5] >= 0.18 || obj.colorHist[4] >= 0.20) && obj.meanSat >= 35) itemPenalty = -0.35;
      } else if (isTopSpear) {
        if (obj.area >= 305 || obj.area < 150 || obj.rmsRadius >= 15.2 || obj.rmsRadius < 10.5 || obj.colorHist[4] >= 0.35 || obj.elongation < 6.0 || obj.colorHist[3] >= 0.20 || slotWood < 0.30 || obj.meanSat < 26) {
          itemPenalty = 1.10;
        } else if (obj.elongation < 7.45 || obj.fillRatio >= 1.44) {
          const r64 = extractBoxObject({ width: bw, height: bh, data: bp }, obj.cx - 32, obj.cy - 32, obj.cx + 32, obj.cy + 32);
          if (r64 && r64.area <= 290 && r64.elongation >= 6.0 && r64.fillRatio <= 1.50) {
            itemPenalty = -0.85;
          } else {
            itemPenalty = 1.10;
          }
        } else {
          const r64 = extractBoxObject({ width: bw, height: bh, data: bp }, obj.cx - 32, obj.cy - 32, obj.cx + 32, obj.cy + 32);
          if (r64 && r64.area <= 290 && r64.elongation >= 7.5 && r64.fillRatio <= 1.35) {
            itemPenalty = -0.45;
          }
        }
      } else if (isTopNecklace) {
        if (slotGray >= 0.26 || obj.colorHist[4] <= 0.18 || obj.colorHist[4] >= 0.48 || obj.meanSat <= 51 || obj.elongation >= 2.85 || (obj.colorHist[5] >= 0.45 && obj.colorHist[4] <= 0.20)) {
          itemPenalty = 1.00;
        } else if (obj.rmsRadius < 10.5 && obj.area >= 300 && obj.meanSat >= 75 && slotGray <= 0.04 && obj.colorHist[4] >= 0.30 && obj.colorHist[5] >= 0.30) {
          itemPenalty = -1.45;
        }
      } else if (isTopHat) {
        if ((obj.colorHist[2] + obj.colorHist[3]) < 0.15 || obj.meanSat >= 52 || slotGray >= 0.32) itemPenalty = 1.00;
        else if ((obj.colorHist[2] + obj.colorHist[3]) >= 0.25 && obj.area >= 700 && obj.elongation <= 1.85) itemPenalty = -0.55;
      }

      const cmp = compareObjects(topObj, obj);
      if (!isNaN(cmp.totalScore)) {
        const shapeScore = cmp.bestPolarDist * 1.3 + cmp.elongDiff * 1.0 + cmp.fillDiff * 0.8 + areaPenalty + rmsPenalty;
        const combined = shapeScore + cmp.totalScore * 0.25 + itemPenalty;
        candidates.push({ x: obj.cx, y: obj.cy, score: combined, obj });
      }
    }

    for (let y = 84 + bH / 2; y <= bh - bH / 2 - 2; y += step) {
      for (let x = bW / 2 + 4; x <= bw - bW / 2 - 4; x += step) {
        let fgCount = 0;
        for (let sy = y - bH / 2; sy <= y + bH / 2; sy += 4) {
          for (let sx = x - bW / 2; sx <= x + bW / 2; sx += 4) {
            const idx = (Math.round(sy) * bw + Math.round(sx)) * 4;
            if (0.299 * bp[idx] + 0.587 * bp[idx + 1] + 0.114 * bp[idx + 2] > 42) fgCount++;
          }
        }
        if (fgCount < (isTopSpear ? 9 : 16)) continue;

        const obj = extractBoxObject({ width: bw, height: bh, data: bp }, x - bW / 2, y - bH / 2, x + bW / 2, y + bH / 2);
        evalObj(obj, x, y, false);
        if (isTopClub && topObj.elongation < 4.7 && obj && obj.area < topObj.area * 0.55) {
          const wObj = extractWarmClubObject({ width: bw, height: bh, data: bp }, x - bW / 2, y - bH / 2, x + bW / 2, y + bH / 2);
          if (wObj && wObj.elongation >= 2.8 && wObj.area >= 480) evalObj(wObj, x, y, true);
        }
      }
    }

    candidates.sort((a, b) => a.score - b.score);
    const dedupDist = isTopSpear ? 31 : 25;
    const unique = [];
    for (const c of candidates) {
      if (!unique.some(u => Math.hypot(u.x - c.x, u.y - c.y) < dedupDist)) unique.push(c);
    }

    const scores = unique.map(u => +u.score.toFixed(2));
    const maxK = Math.min(6, scores.length);

    let count = 1;
    let rule1Hit = false;
    for (let k = 1; k < maxK; k++) {
      const cur = scores[k - 1];
      const next = scores[k];
      if ((cur <= 1.65 && (next - cur) >= 0.95 && next >= 2.45) || (k >= 2 && cur <= 1.95 && (next - cur) >= 1.25 && next >= 3.15)) {
        count = k;
        rule1Hit = true;
        break;
      }
    }

    if (!rule1Hit) {
      let rule2Hit = false;
      for (let k = 1; k <= maxK; k++) {
        const cur = scores[k - 1];
        const next = k < scores.length ? scores[k] : 99;
        if (cur <= 3.32 && next >= 3.36 && (next - cur) >= 0.25) {
          count = k;
          rule2Hit = true;
          break;
        }
      }
      if (!rule2Hit) {
        let valid = 0;
        for (let i = 0; i < maxK; i++) {
          if (scores[i] <= 3.32) valid++;
          else break;
        }
        count = Math.max(1, Math.min(6, valid));
      }
    }

    const excludeRaw = options && options.excludeCounts;
    const excludeSet = excludeRaw instanceof Set
      ? excludeRaw
      : new Set(Array.isArray(excludeRaw) ? excludeRaw.map(Number) : []);
    if (excludeSet.size > 0 && excludeSet.has(count)) {
      const nextCandScore = count < scores.length ? scores[count] : 99;
      const prevCandScore = count >= 2 ? scores[count - 2] : 0;
      const preferPlusOne = (3.45 - nextCandScore) >= (prevCandScore - 3.15);
      const order = preferPlusOne
        ? [count + 1, count - 1, count + 2, count - 2, 1, 2, 3, 4, 5, 6]
        : [count - 1, count + 1, count - 2, count + 2, 1, 2, 3, 4, 5, 6];
      for (const cand of order) {
        if (cand >= 1 && cand <= 6 && !excludeSet.has(cand)) {
          count = cand;
          break;
        }
      }
    }

    const matched = unique.slice(0, count);
    const confidence = Math.max(50, Math.min(99, Math.round(100 - (scores[0] || 2) * 12)));

    return {
      count,
      confidence,
      items: matched.map(m => ({ x: Math.round(m.x), y: Math.round(m.y), score: m.score })),
      scores: scores.slice(0, 8)
    };
  }

  function extractSlotObjectForOdd(boardData, x1, y1, x2, y2) {
    const bw = boardData.width, bh = boardData.height, bp = boardData.data;
    x1 = Math.max(0, Math.min(bw - 1, Math.round(x1)));
    x2 = Math.max(x1 + 4, Math.min(bw - 1, Math.round(x2)));
    y1 = Math.max(0, Math.min(bh - 1, Math.round(y1)));
    y2 = Math.max(y1 + 4, Math.min(bh - 1, Math.round(y2)));
    const w = x2 - x1 + 1, h = y2 - y1 + 1;
    const R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h);
    const isRing = new Uint8Array(w * h);
    let ringCnt = 0;
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        const i = ((y1 + ly) * bw + (x1 + lx)) * 4;
        const r = bp[i], g = bp[i + 1], b = bp[i + 2];
        const p = ly * w + lx;
        R[p] = r; G[p] = g; B[p] = b;
        if (g > 110 && r < 75 && b > 65 && (g - r) > 55) {
          isRing[p] = 1;
          ringCnt++;
        }
      }
    }
    if (ringCnt >= 18) {
      const dil = new Uint8Array(isRing);
      for (let ly = 1; ly < h - 1; ly++) {
        for (let lx = 1; lx < w - 1; lx++) {
          const p = ly * w + lx;
          if (isRing[p]) { dil[p - 1] = 1; dil[p + 1] = 1; dil[p - w] = 1; dil[p + w] = 1; }
        }
      }
      isRing.set(dil);
      for (let pass = 0; pass < 5; pass++) {
        const cR = new Float32Array(R), cG = new Float32Array(G), cB = new Float32Array(B);
        const next = new Uint8Array(isRing);
        for (let ly = 2; ly < h - 2; ly++) {
          for (let lx = 2; lx < w - 2; lx++) {
            const p = ly * w + lx;
            if (!isRing[p]) continue;
            let sr = 0, sg = 0, sb = 0, c = 0;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
              const np = (ly + dy) * w + (lx + dx);
              if (!isRing[np]) { sr += cR[np]; sg += cG[np]; sb += cB[np]; c++; }
            }
            if (c > 0) { R[p] = sr / c; G[p] = sg / c; B[p] = sb / c; next[p] = 0; }
          }
        }
        isRing.set(next);
      }
    }

    for (let pass = 0; pass < 2; pass++) {
      const nR = new Float32Array(R), nG = new Float32Array(G), nB = new Float32Array(B);
      const rad = pass === 0 ? 2 : 3;
      for (let ly = rad; ly < h - rad; ly++) {
        for (let lx = rad; lx < w - rad; lx++) {
          const p = ly * w + lx;
          if (pass === 1 && R[p] > G[p] + 12 && G[p] >= B[p] - 2) continue;
          const dirs = [[p - rad, p + rad], [p - rad * w, p + rad * w], [p - rad * w - rad, p + rad * w + rad], [p - rad * w + rad, p + rad * w - rad]];
          let matchPairs = 0, sR = 0, sG = 0, sB = 0;
          for (const [p1, p2] of dirs) {
            const d12 = Math.abs(R[p1] - R[p2]) + Math.abs(G[p1] - G[p2]) + Math.abs(B[p1] - B[p2]);
            const mR = (R[p1] + R[p2]) * 0.5, mG = (G[p1] + G[p2]) * 0.5, mB = (B[p1] + B[p2]) * 0.5;
            const dC = Math.abs(R[p] - mR) + Math.abs(G[p] - mG) + Math.abs(B[p] - mB);
            if (d12 < 24 && dC > 30 && (pass === 0 || dC < 190)) { matchPairs++; sR += mR; sG += mG; sB += mB; }
          }
          if (matchPairs >= 2) { nR[p] = sR / matchPairs; nG[p] = sG / matchPairs; nB[p] = sB / matchPairs; }
        }
      }
      R.set(nR); G.set(nG); B.set(nB);
    }
    for (const rad of [3, 4, 3, 4]) {
      const nR = new Float32Array(R), nG = new Float32Array(G), nB = new Float32Array(B);
      for (let ly = rad; ly < h - rad; ly++) {
        for (let lx = rad; lx < w - rad; lx++) {
          const p = ly * w + lx;
          const dirs = [[p - rad, p + rad], [p - rad * w, p + rad * w], [p - rad * w - rad, p + rad * w + rad], [p - rad * w + rad, p + rad * w - rad]];
          let scribPairs = 0, sR = 0, sG = 0, sB = 0;
          for (const [p1, p2] of dirs) {
            const d12 = Math.abs(R[p1] - R[p2]) + Math.abs(G[p1] - G[p2]) + Math.abs(B[p1] - B[p2]);
            if (d12 >= 22) continue;
            const mR = (R[p1] + R[p2]) * 0.5, mG = (G[p1] + G[p2]) * 0.5, mB = (B[p1] + B[p2]) * 0.5;
            const dR = R[p] - mR, dG = G[p] - mG, dB = B[p] - mB;
            const chromaDelta = Math.max(dR, dG, dB) - Math.min(dR, dG, dB);
            if (dR > 10 && dG > 10 && dB > 10 && dR < 85 && chromaDelta <= 16) { scribPairs++; sR += mR; sG += mG; sB += mB; }
          }
          if (scribPairs >= 1) { nR[p] = sR / scribPairs; nG[p] = sG / scribPairs; nB[p] = sB / scribPairs; }
        }
      }
      R.set(nR); G.set(nG); B.set(nB);
    }

    const colorBins = new Map();
    for (let ly = 2; ly < h - 2; ly++) {
      for (let lx = 2; lx < w - 2; lx++) {
        const p = ly * w + lx;
        let maxDiff = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const np = (ly + dy) * w + (lx + dx);
          const d = Math.abs(R[p] - R[np]) + Math.abs(G[p] - G[np]) + Math.abs(B[p] - B[np]);
          if (d > maxDiff) maxDiff = d;
        }
        if (maxDiff <= 13) {
          const kr = Math.round(R[p] / 8), kg = Math.round(G[p] / 8), kb = Math.round(B[p] / 8);
          const key = (kr << 12) | (kg << 6) | kb;
          let entry = colorBins.get(key);
          if (!entry) { entry = { count: 0, borderCount: 0, sumR: 0, sumG: 0, sumB: 0 }; colorBins.set(key, entry); }
          entry.count++;
          if (lx <= 8 || lx >= w - 9 || ly <= 8 || ly >= h - 9) entry.borderCount++;
          entry.sumR += R[p]; entry.sumG += G[p]; entry.sumB += B[p];
        }
      }
    }
    const bgColors = [{ r: 25, g: 22, b: 37 }];
    for (const entry of colorBins.values()) {
      const mr = entry.sumR / entry.count, mg = entry.sumG / entry.count, mb = entry.sumB / entry.count;
      const sum = mr + mg + mb, sat = Math.max(mr, mg, mb) - Math.min(mr, mg, mb);
      const isWarmBrown = mr > mg + 10 && mg >= mb - 3;
      const minCnt = isWarmBrown ? 140 : 32;
      if (sum >= 65 && sum < 260 && sat < 56 && (entry.count >= minCnt || (entry.borderCount >= 6 && entry.count >= 16 && !isWarmBrown))) {
        bgColors.push({ r: mr, g: mg, b: mb });
      }
    }

    const mask = new Uint8Array(w * h);
    for (let ly = 2; ly < h - 2; ly++) {
      for (let lx = 2; lx < w - 2; lx++) {
        const p = ly * w + lx;
        let minDist = Infinity;
        for (const bg of bgColors) {
          let d = Math.abs(R[p] - bg.r) + Math.abs(G[p] - bg.g) + Math.abs(B[p] - bg.b);
          if (G[p] - B[p] > 6 && bg.b - bg.g > 4) {
            d += ((G[p] - B[p]) - (bg.g - bg.b)) * 0.75;
          }
          if (d < minDist) minDist = d;
        }
        if (minDist > 28) mask[p] = 1;
      }
    }

    const eroded = new Uint8Array(w * h);
    for (let ly = 2; ly < h - 2; ly++) {
      for (let lx = 2; lx < w - 2; lx++) {
        const p = ly * w + lx;
        if (!mask[p]) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += mask[(ly + dy) * w + (lx + dx)];
        if (n >= 5) eroded[p] = 1;
      }
    }
    const visited = new Uint8Array(w * h);
    const comps = [];
    for (let ly = 2; ly < h - 2; ly++) {
      for (let lx = 2; lx < w - 2; lx++) {
        const p = ly * w + lx;
        if (eroded[p] && !visited[p]) {
          const q = [p]; visited[p] = 1;
          const pts = []; let sx = 0, sy = 0;
          while (q.length > 0) {
            const cur = q.pop();
            const cy = Math.floor(cur / w), cx = cur % w;
            pts.push([cx, cy]); sx += cx; sy += cy;
            for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
              const ny = cy + dy, nx = cx + dx;
              if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
                const np = ny * w + nx;
                if (eroded[np] && !visited[np]) { visited[np] = 1; q.push(np); }
              }
            }
          }
          if (pts.length >= 16) comps.push({ pts, count: pts.length, cx: sx / pts.length, cy: sy / pts.length });
        }
      }
    }
    comps.sort((a, b) => b.count - a.count);
    if (!comps.length) return null;

    const finalMask = new Uint8Array(w * h);
    const main = comps[0];
    const validPts = [];
    for (const c of comps) {
      const distMain = Math.hypot(c.cx - main.cx, c.cy - main.cy);
      if (c === main || (c.count >= 25 && distMain <= 42)) {
        for (const [px, py] of c.pts) {
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const ny = py + dy, nx = px + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
              const np = ny * w + nx;
              if (mask[np] && !finalMask[np]) { finalMask[np] = 1; validPts.push([nx, ny]); }
            }
          }
        }
      }
    }
    if (validPts.length < 10) return null;

    let warmCnt = 0;
    for (const [px, py] of validPts) {
      const p = py * w + px;
      if (R[p] > G[p] + 8 && R[p] > B[p] + 6) warmCnt++;
    }
    if (warmCnt >= validPts.length * 0.45) {
      const prunedPts = [];
      for (const [px, py] of validPts) {
        const p = py * w + px;
        const r = R[p], g = G[p], b = B[p];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        if (l < 90 && (b > r + 2 || g > r + 4)) {
          finalMask[p] = 0;
        } else {
          prunedPts.push([px, py]);
        }
      }
      if (prunedPts.length >= 120) {
        validPts.length = 0;
        for (const pt of prunedPts) validPts.push(pt);
      }
    }

    const grad = new Float32Array(w * h);
    for (let ly = 1; ly < h - 1; ly++) for (let lx = 1; lx < w - 1; lx++) {
      const p = ly * w + lx;
      grad[p] = Math.abs(R[p + 1] - R[p - 1]) + Math.abs(G[p + 1] - G[p - 1]) + Math.abs(B[p + 1] - B[p - 1])
              + Math.abs(R[p + w] - R[p - w]) + Math.abs(G[p + w] - G[p - w]) + Math.abs(B[p + w] - B[p - w]);
    }

    let cx = 0, cy = 0, lumSum = 0, lumSqSum = 0, satSum = 0, sumR = 0, sumG = 0, sumB = 0;
    const colorHist = new Float32Array(8);
    for (const [px, py] of validPts) {
      cx += px; cy += py;
      const p = py * w + px;
      const r = R[p], g = G[p], b = B[p];
      sumR += r; sumG += g; sumB += b;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      lumSum += l; lumSqSum += l * l; satSum += sat;
      if (sat < 22) { if (l > 95) colorHist[0]++; else colorHist[1]++; }
      else if (b > r + 15 && b >= g) colorHist[2]++;
      else if (b > g + 6 && r > g + 2 && r < b + 25) colorHist[3]++;
      else if (r - g > 42 && r > b + 35) colorHist[4]++;
      else if (r > g + 5 && r > b + 50 && g > b + 30) colorHist[5]++;
      else if (r >= g && g >= b - 8) colorHist[6]++;
      else colorHist[7]++;
    }
    for (let i = 0; i < 8; i++) colorHist[i] /= validPts.length;
    cx /= validPts.length; cy /= validPts.length;
    const meanLum = lumSum / validPts.length;
    const stdLum = Math.max(10, Math.sqrt(Math.max(0, lumSqSum / validPts.length - meanLum * meanLum)));
    const meanSat = satSum / validPts.length;
    const meanR = sumR / validPts.length, meanG = sumG / validPts.length, meanB = sumB / validPts.length;

    let m20 = 0, m02 = 0, m11 = 0, r2Sum = 0;
    for (const [px, py] of validPts) {
      const dx = px - cx, dy = py - cy;
      m20 += dx * dx; m02 += dy * dy; m11 += dx * dy; r2Sum += dx * dx + dy * dy;
    }
    m20 /= validPts.length; m02 /= validPts.length; m11 /= validPts.length;
    const rmsRadius = Math.max(2, Math.sqrt(r2Sum / validPts.length));
    const trace = m20 + m02;
    const det = Math.sqrt((m20 - m02) * (m20 - m02) + 4 * m11 * m11);
    const l1 = Math.max(1, (trace + det) * 0.5), l2 = Math.max(1, (trace - det) * 0.5);
    const elongation = Math.sqrt(l1 / l2);
    const fillRatio = validPts.length / (rmsRadius * rmsRadius);

    const NR = 12, NA = 36;
    const polarMask = new Float32Array(NR * NA), polarLum = new Float32Array(NR * NA), polarGrad = new Float32Array(NR * NA);
    for (let rIdx = 0; rIdx < NR; rIdx++) {
      const rNorm = 0.15 + (rIdx / (NR - 1)) * 1.9;
      const rad = rNorm * rmsRadius;
      for (let aIdx = 0; aIdx < NA; aIdx++) {
        const ang = (aIdx * 2 * Math.PI) / NA;
        const px = Math.round(cx + rad * Math.cos(ang)), py = Math.round(cy + rad * Math.sin(ang));
        let mVal = 0, lVal = 0, gVal = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const sx = px + dx, sy = py + dy;
          if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
            const p = sy * w + sx, m = finalMask[p];
            mVal += m;
            if (m) {
              const l = 0.299 * R[p] + 0.587 * G[p] + 0.114 * B[p];
              lVal += (l - meanLum) / stdLum;
              gVal += grad[p] / 100;
            }
            cnt++;
          }
        }
        if (cnt > 0) {
          polarMask[rIdx * NA + aIdx] = mVal / cnt;
          polarLum[rIdx * NA + aIdx] = mVal > 0 ? lVal / mVal : 0;
          polarGrad[rIdx * NA + aIdx] = mVal > 0 ? gVal / mVal : 0;
        }
      }
    }
    return {
      cx: cx + x1, cy: cy + y1, x: Math.round(cx + x1), y: Math.round(cy + y1),
      area: validPts.length, rmsRadius, elongation, fillRatio,
      meanLum, stdLum, meanSat, meanR, meanG, meanB, colorHist, polarMask, polarLum, polarGrad
    };
  }

  /**
   * Auto-solve Odd-One-Out Challenge ("แยกผิดประเภท" / "กดอันที่ไม่เข้าพวก").
   * Identifies 5 horizontal items, computes pairwise distance matrix, and picks outlier.
   * Returns { slot: 1..5, x, y, confidence, margin, ranked }.
   */
  function solveOddChallenge(boardData, options = {}) {
    if (!boardData || !boardData.data) return null;
    const bw = boardData.width || 480;
    const rawBh = boardData.height || 330;
    const bh = (bw === 480 && (rawBh === 368 || rawBh === 398)) ? (rawBh - 38) : rawBh;
    const bp = boardData.data;

    const sectionX = [[10, 106], [102, 198], [194, 290], [286, 382], [378, 474]];
    const items = [];

    for (let sIdx = 0; sIdx < 5; sIdx++) {
      const [x1, x2] = sectionX[sIdx];
      const obj = extractSlotObjectForOdd({ width: bw, height: bh, data: bp }, x1, 60, x2, bh - 25);
      const cx = obj ? Math.round(obj.cx) : Math.round((x1 + x2) / 2);
      const cy = obj ? Math.round(obj.cy) : 180;
      items.push({ slot: sIdx + 1, x: cx, y: cy, obj });
    }

    const dist = [];
    for (let i = 0; i < 5; i++) {
      dist[i] = [];
      for (let j = 0; j < 5; j++) {
        if (i === j) {
          dist[i][j] = 0;
        } else if (items[i].obj && items[j].obj) {
          const a = items[i].obj, b = items[j].obj;
          const cmp = compareObjects(a, b);
          if (isNaN(cmp.totalScore)) {
            dist[i][j] = 10;
          } else {
            const lumBoardDiff = Math.abs(a.meanLum - b.meanLum) / 26;
            const rgNormA = (a.meanR - a.meanG) / Math.max(30, a.meanLum);
            const rgNormB = (b.meanR - b.meanG) / Math.max(30, b.meanLum);
            const hueRatioDiff = Math.abs(rgNormA - rgNormB) * 1.8;
            const warmA = a.colorHist[4] + a.colorHist[5] + a.colorHist[6];
            const warmB = b.colorHist[4] + b.colorHist[5] + b.colorHist[6];
            const splitWarmDiff = Math.abs((a.colorHist[4] + a.colorHist[5]) - (b.colorHist[4] + b.colorHist[5])) + Math.abs(a.colorHist[6] - b.colorHist[6]);
            const warmRelief = (warmA >= 0.65 && warmB >= 0.65) ? Math.max(0, splitWarmDiff - Math.abs(warmA - warmB)) * 0.45 : 0;
            dist[i][j] = cmp.totalScore + lumBoardDiff + hueRatioDiff - warmRelief;
          }
        } else {
          dist[i][j] = 10;
        }
      }
    }

    const scores = items.map((it, i) => {
      const otherDists = dist[i].filter((_, j) => j !== i).sort((a, b) => a - b);
      const minOther = otherDists[0];
      const sumAll = otherDists.reduce((a, b) => a + b, 0);
      return { slot: it.slot, x: it.x, y: it.y, minOther, sumAll };
    });

    scores.sort((a, b) => b.minOther - a.minOther);
    const excludeRaw = options && options.excludeSlots;
    const excludeSet = excludeRaw instanceof Set
      ? excludeRaw
      : new Set(Array.isArray(excludeRaw) ? excludeRaw.map(Number) : []);
    const available = excludeSet.size > 0 ? scores.filter(s => !excludeSet.has(s.slot)) : scores;
    const winner = available[0] || scores[0];
    const runnerUp = available[1] || scores.find(s => s !== winner) || { minOther: 0 };
    const margin = Math.max(0, winner.minOther - runnerUp.minOther);
    const confidence = Math.max(50, Math.min(99, Math.round(60 + margin * 15)));

    return {
      slot: winner.slot,
      x: winner.x,
      y: winner.y,
      confidence,
      margin,
      ranked: scores
    };
  }

  const ROTATE_ICON_POLAR_B64 = 'eY+MnH2Lm3lYacy7rOvqn+/+97eGVHqJRqx3VmSGhkeZjIqMWGk2eIeYh5pWZ3qthtlnaJbKmzSHiGR1NX1bi4ZjmVWYZM1nRFRDRmpo+HdnyYm8ZWWYRXlY/Prap5pUQ0RjU2hEQUFjM1dTykRBQTNUQVOZZlVCVXmqimd4V1hXVliK3P7v3IhGRERERERE/O5GVmZEZoe2tpmYaO+qu/5ERERERIn+hoeotphERMqLl4mIqu9oe7lEmlRXqKpXlprvh0RERER7RESHeIesm+/KRESHmoh6iFa7RP9ERERERFdWm1ZVRESJREREREREv4h2ZWZ2dXR1dnaGZWVkdYuNv8/d6fzeh4fJ+J6qp6fn9ffKqHy95p6qy6yfdnd3aWaaVGWZhmWYeIqopoaYqIa5qphkR0RVVVZXerlKRUVpWWZlVuqteXSpio44TDWPMjZFVolENDIyMjIyWjMzh/adRzIyMjIymWlHRlh6m4mLSldXae33+lw4RUZpypyaeadGZFiMvIiYp2edd3mLrYu+iYnMu5hnZLlTVHNzY0PLMnOFdJm1xdTlqFiDc2VmlaiHnGVnuJnaeUh4mKe9zcrt2vin2IimIq00WiIhRyNZjiJZJFoijyIhITZFIiHOt6uLd3aIiHhpbX17e6mpqJi5x7ioytbHfolrVlZ4Z4eVpcXE1dXLrLrJu5i3ysfINFyYjLWmMzmFipy71K80MzQ3ir2rva2KMzOFmZWlMzN2io9NujMzMzMzM7zUuKhMMzM2a4eaMzN6folYODMzMzMzMzTUtHUzyuvqzcnHh76/RkREVURFRENDQ0NEVniZrKnb3cl2uGhrd5l3d5lXaFi7nEWceNqeaGh2h1nJZ2lHaXfnuc26mpfbjVXqt5d4Q3z8VlVWRXdDeFeXqUVDV+31REOfvXlWQ0NDQ0NDQ0NDV5l8Q0NDnkh+Q0NDWtn4nXuNe1ZGVXm79/n4y+r69/y8aFdGVmZXd2l5Z5zuV95qeGZldmZmZ3uM30Wt6t6JmZx5eWdpZmVVVVeHvfRon31lZn5oZWZVdWdVVYxlVVVVi1VmiftmZ/Xzd1ZVeGhmU1NTU1NTZ2ZoU1NTU1NTU1WfnWadVFNTZlZWZlZWZmZoy8mqZ2iavKzK+ZuM7mpXnI/Ki1mpaIrPVneYhdu8qdrq95yZmZqaich4WHidl/XZi0OVud1DQ0ND+0afNldHeFVn1mjtmMi6zUNXi0NDQ0NDQ0lXVohDQ0OIiFhERNtDQ0NDQ0NDQ0NDQ99GZ0NDZ2ZmZWZmd4d3VVZ3eHmKipmKu4t6aZyLqXpVm89mVGZVVFbd9Pb6ysr+uWd4iZm8V3dWeP+KZlVWVrxnae1tU527iniJVX/vVJuIRnhVVWiHRmj8RVNTU1P+l1W+U1NTU1NTRW37ZtqcRlNTU1NTU1NT9sZTU1NTl2dmZmdorJ18nJy9jHur6Pnqmqt7rYqJVFRmtnlUVFateYvNZ1RUVFRUnHq9rGtnVFRUVGZUVGn8vM2bVFRUVFRUVJubi71UVFRUVFRUVFXc/ftoVFRUVFRUVFV4vZpUVFRUVFRUVFS9//5UVFRUVFRUVFS8/KlUeGZmeIiYyMnJucra9/j39urLqJeXqpmZWWeamNqXdWdnp5l4nK+vn7+tzIapucp8RERan7nJyqmKiK9ERERERERF3Fe5REREREREREbYhpi5RERERERERERF31q7REREREREREREzNtEREREREREREREaslFREREiWloiHiJyvr5qpipilZIellWjc7dm0RVemd6yleqmFZkVUXqrKqtnOv3ua27m8qbR2lXV2YyMjIyMnqKl2eLedvJif2MvmtXZcnIMjIyanW2tnWHabv5aYpnMzPNrPtaVDJWtzIydzIyMpmIZjIyMlaKVYkyQzIyZ1Zlu/3cm5t5Wr3M7ol4eYiY2fn59unJaIpXZIp3V1ns+XmLmlmHV1h4Rouqd5eK36xoaHu5QtxFaJpriHh4p89qVFVU28yuVZV6QkJCRmamm5llRFR7VbyJQkLKRodVQkKKiEJWQkKIWLhpQkJCQ0JCaXpCQkJCuXppeb29WFZmZldXaXqJep2eaEpbnoqqfIh3iKhGh9j42fa6zLyKuHy5voqnesnLhmyInjWaV2n099lXi5iMeHa4nXeqyrqp1ZlUd6YyZjFDVXdFh5d3mnxlRVVW96eaRm13RDExMTGMMkRFqjFDMTExVkYxMTExm49ejvv6i4maq6qreXh4ZmRkdszL2Zt5rmVYZoi6W3fNVYrr6fw2N3ZFZmZmdbqnRKqqREd2dtq63aq6nXzs3DZEVTEyRWdkipqbelaFVVW6y7pYRYrpVpdpmIiYejTpZ6lXqTExMUJEZUWWVzEzMjExaFYxMTEyuJenyZuKep6Nm8jZ2NfbfFVWa7fFxci618lZZIpVnYpbub5XWF2Iemqb1Xrk48S0aEmqm3haeIeHuGiZeXy+l5lpV1d56I1cqH7JWzExMUYyakdo1lpYtTVoNTJZNUfYRWhbqTExa9Wqt9UzRTExRDExuzIxMTExnWyfnbuaZlVmd6qteHZ3jLy8ZmZVWoqbNDRliKpFU0RkREZEVFWvVotXmrn4qkTPRGd2m7mFi1NDR6VFi0ZmaZ1jmdutrIp9qci8Voqb+DKoxVd5aqf4VflHMkRZm2ep2PhXiDIxMzH6xrmK+TJD1zIzRDJ4MYhn7r2by4pWZ0U2aLvL7Vp7mGZVe3ioyvr5rZ1WZ3bNiIlXm/+reWf/zoh2hpe6+mpoR5v7WWWXQ0NC23VWi7ra37xmaHaIyHmth/m4qUJDmXeLRHVEZWZneZlDaENWRHhUQlZCQkJkQ0JUV3WWQkRVQkJXmldCQkJmr3tq/fq5mMno+bupiId2iWhpicfZt4lZjHiIvoirZ2y8ZnipaHxZh5t2yIl5uWNp+Jt4u/p4V+lXy4m53FZnv4dnrJh1ZoeY/UdXNDLfZTGdQ0QyM3Z3NIpnjEMxuJt7aDF0MngxMTF2dDIxMTExNGiYmzV6RDEyb26tumlXVXiIZVZWaIyNSYqptrW11+nuebfL6rh0qseZWJy7m1h4WomZelev+OeYncXUaXiIRTRoi5qZd1d8Wehnu5jL6J3YqIi8aTGH1noxRmTHaoucqXdHMjEze7n/MTNXQ0dFMVSXZFIzRDQxMTMxa4k1MTE116iZe7q5uaipqZiIuayaaY2sy3l5qrvLrNf16ndoiGhWi9jK6J+Yd4VqmWmXmreemch2NTVHaTIyNoeKlpp3azJp1lgyiInXV2l6ejIy3DIypliZZqzkfFi51ro0n/SNMpY0NDIyMjIyj0hpNDKpqTIyMjIya3syrHuZaldWVVVWes+tVnVlRmqcu9nJyrm6i2dkiqepiqyveEfNqepYqYe7Y3bbuJu4dqlVeFd2U/tXt/lEWLj6y4eorFp1VZiIqZe9hkYyyjJFWGSFefeLJEd33Wm7Z4mrMjIyjDQyzzJIMlZFMrVXMkZkNDIyrDIydoqc+/r8e4iZma2LVomZytvdeamKa1ZYtql4R2lnas6pqZiGtszPlnupyom4aVarWVhInVmHq1amq5d39ZmbqVWJeWd3inVHd6mbd3hWMTFWup931mllRWZnjDFWZYb2RlRErEgxMTExMZj4aWcxMYoxMTQyMTE1Vll6mnp6lpWWnFlVVmV2mausqqfGtZiIWYeGmJWoeWieusTKabXDxdjpqJ2dpph3mknWa2loi1arWY2Z5Nu22Jr45qhqVmZoR0YyRjNHRjIyR+d4r39qZ8wyMlk0W7+vMkYyRzJHMzIyfY1GN/TY9lpHbDIyRTIySnupxMPEqqmYt7i3w8PDw8PDxMXHyX1cmYp6R0h5eWh6Wre1fMfTq3unWpdbrGpsmHuph1e5iaioZWpqV2iaaWuaa6h2mmdaxDt5eTgkNiVHmniNxp8jxpWtJn/Dw8SeIyN4qiMjIyMji2ojbcQji8UjIyMkIyOPqcfHqKqqi3pqanqJqLmqm7fF09TExLaoqJh6aoipqqiHhptnfJh6a3dsi6zFxMTEeH6alsjGuceXmJl7inyIp4kkIiIkq4xtannEuToiryI6tba2dbaJp2l6IjdtfSI4IlmIrCMiIoxrpnZ5J5UiIiIifXwjIiIipo2cqbm4eWhXmpp5u7y7Z979rM2te5ioeYuKnrlERUWLrK+JabmKZ5nqmWZlZWRXhXhGh3q5Vpf6R1WIl5d1eVh4RXupeUVUczNV9pX0jrynWLi7uXdGl8pEMZhHx2kxRokyaFU2MTExRDIxREVUMVUxM0Psru8xeZeXl4mJjJqp2sqpqZinu8zdnKqsaVhYxMR9rLi4t4uZ5eTaqfKpm7x7eFc4bjiYyLo2Z6eItbWGqGZGtvPKZHZXeaisWzarNEczRTGXa4pbuKmKqJysalqMMjZbNDVrWFUhWSFpIWghMjZZeeVrISExZW0hISEhVViLz3lXeIiHeFdXrKqp7fr33r/dq4toeMzN68t5eYeGh0loRmaJaI2ai4xnePvKqZhZaL2dVlWIevqrePdWdlVUVVVViHx67VaZuc9lQmhEVFZ2dVRVmXhCQ2eLZkZnQkO5VodCQkSJlXdDVENCQkJVuENCQkJCV2VmmId3aauriMy7qldZmce3h6enuYp57M96RGRkZlWMV0n4+a3PvsqtyNf7u6uqiolYRUJCQ3qFh2dUiKqoVrx4mnerunybRotGilSJZ4qIQ7t5d3pDh2hDQnqrZkStQkJCQplCQkJDQkJ4QkJWVkNqyo5Ci2dC+b58dmVmmWdYq+zciJmZvGdnm4uKmam4R5xojntoRblp+euLq52+ZVP7jKq+6byJeGmZZmXHMzJERYnJWkZJqoeXhmZVy2OthmaIZFVEMkVVh2uGrGRnasxERNtmVZpVeDIy+XkyNGhD74UyljIyMjNnmzIyMjIy6cm4moqZeVdnm8uri4qYycqpqouJiK3cja5YeJeInIrIRmZnnHqomamq+/N9Z7x4yIlZnjIyRaZ5M5iXi9t59t1pNDNJl6lXe3hYMkR8xpvG3PncRlXbRUc0RosyMjIyMjJ1MkR61zIyV4xEMzIyMjJqaTIyMjIypotsW3iIWY2bh2ZYampqrHyM1rvJmYmonG1ld4hVmMeJaVmJqtmoprlK4+LXabipaViqVmtFlngym8bUaG5HVInV48fiimtnioepWIhbICGGi1yVt7nKR3jjTVnmmqt7iSCmJCEkIEdbSFZ4gkibIFfbICAgriAi2KqrnJusiomKenhpaoury5yLy9nHtqjKq9eMVkZ5R2ppWaibqLrX9ayomIytx6hmeohZZfPKepi75kZ9jYlndzQhISE1SUU0V7f2q1aYeL22eKatdUbbrCEhISFmZ9s0IZmseHghNCFWZ6ZZMzV1ZiEhISFXjGchSVl6mZqbuop5mKiJiqnH1NPT1NPT08eamYt5matHRXtpeoh5V8jXrden5NPUq5ibbHmKfJ2Kiltae3t9mavUuY40MjWsacdLebeXasSpent5rZp+OI42NFgzfEk1MzUzMqWYSTIyMplVVdSqSTIyMjIzmTIyMjIym2hniYaXqMmolIqamZt5ecfGt6mLfJiXe5imZW1LpqPiyVh8uJi95ZeZmLa1rKubfJbkalpGh0q4d1qElY1nn9fK5LisbMmOqKkjxhBoN0eaOFeHiHurh8h6S4mXt3h1EBBrSjYlEBIQdzYSEBKotyNNOUgQt6cQl4mIinp7h5eol4eIaouLx7a2p7bGxaeWp3ipfHeWpsa2xJmIeIqtelqMxZvV49XTrIyJmNY4SSI6x9bUitV7WaiKqTslicd9iZh5ayIiIkuse3eVyoi2xV9KaIpcS3+2biQiJyIiIiKkpYqUIiKNhSIiI10iIiV/uIh4u9varXh2mqy8+PncaERERFVVZpinnZSGjLuJi5vK9nlYqod/v3mK26mm31qryopmRYlnc1Nl6KlZ22lWm5hXi6r8ZWqNpoeLiFdpMjJViXlnl2VYNFdWfDRFi2loMkaLVTIyMjJF9vhZMjIyMjIyulkyMjIyeKu7x7a3trXFtqa3qXlYbKqop5iZnIqKiseIuqlYWpl7iryJeJfIxci36OfZ5op4W3nIaSMzISEhNI16ZVheiUjZqlmpqmyqidc0ayEhIdnGmtSbr2rOiX57IjWKNFV1IWtFISEhVZo4d7ZrN4sze4k0hFYhITMh68qtaqmKV5yduHx9t7fJqXdYmZqJrq2eqjWGZFXGbX54eInoZ1ebqMqnlJftq7uZiWdlq3dGRYlmvUd2ifxWqJvtQ0VpaDZ5mutV10Qxu7uGMadZR/qKZ5lVMXhFu2d4MYdXMzIyVTMxeLgyMUQxMTFpdplEMTEx1MebSEdHWFdmd5i51NXHvY++5tq+rtfjrHtlitmcmbicW1Z604xmU73j5ayev7zVeppYzGW5qYnGyGmtfcbmyK2IuWk4REVXd2prabd2dmiGiWt4Rme8VkgyR2dlilZlVjNFVVlERUZUR400MjUyMjIyMkYyMjIymn1rvKucR1d5WFdpjLm3t7e3yqyeWIiKrpu4mMxZitvn1dfYtpiK2qmJ9ttajtv6ZnucnFdmZ2acqZrYmZnKeXurqKe7d1dXZptGVjIyMmdUZzK4m3hZNPpYMjJFRK1WWDLGMjMyRDIyMjOcMjIyMjI0yHkyMjIyy9XVw7anp6altbeoh3V1q9XT1ai3yoyc08SluIllZZm1mYeHiImaeomIameKarjJqrhoNVp8EjWpemh7tqh6XGeph3uYWa2aXDu4ERG1XxO7hlzEiaVXRpymxZhmJxFPphERhRGPXGmePIhNiignlIwmaEoRERESaol4aamJdmd3eGZnV4qs2prJ+p18d+3uqlhoeJ32n6tshXNVWIx4jPt12MZ0q/mLiXhod7poVGl3qnt6ip2pe1hnMjJDiP1ZdUfr6rmKMlYzQ7irZXeeVVR2ikOrMmepaFm2aUgyVjOVl6ZDVTIyMjIy3DIyMjIyZ3qJh3eGl6rb65h3fcu6i6uLe2ZlZldYe3tldHVndtjXyHZ5q4rq6XhlVGiqev2ZeFea9nhFVkWJu4ysZob0ec5XmIrLmntnm8pXRUQxMVp5zrqsQ9mqy2mYMTF2enjIMXqMyjQxMmZ3WJoxSDExMzMxu80xMTExlaapeXiLzayLhoaHesrGo5eoqLq6i5mnyGhZVmxYeb55uMaLdrjnypaTmHh4aI6fXHfnloZntcaW42d6t5achISGZ8pm54eKZ3xZamq2hneli69bdjeqITlrO681a/PKISFIl2gkISE3SeZGIyEiISEhOk0hIl4jrEhEibqqiVZmeFd5rqu626qqZ1ZKr29/vlTKuNtoZMrZrlhDVVn8ZnW/muzOq6lWeGfcRFNFVVP6d727RXVF+XOqaXV2jGSId5bpVVd2iHpXdURl+vhYWFhUQ0Nkqlh2MWllVMkxMTH4dZZFRGhGVDFnMWiYVmgxqlhmd0ZFR1dYdod5emeXl5eYvKqamXmIZlZliIU1iFpoRkVUQkjbZmeHY7ubnJpoRWWF1PpIiEW6l71b95efaEbJ+/i8moWJu9maVVcxMTO7REOsd/fsp50xMb3/rZyLjKpnMUQxMTFE+1VmuErNeEdUQzGoMX9rV1h5dnR2l3RzdXloZnt7i3p3iYmJimpp+5tZnFZkqWR3a3m89d7ZmcypupvMl7q9zIuaRmd2hJWdM6hJnHdWuYfWtNqJlVd4N5apa57HuDlHm4ynamjaXob19OdUXqhoIiLdZ0chITUidr0iNSEzITJWyUMhISEhypeHmYaHiGZ3iIiYusu7ntnY2unbntnp12pjeVRYimlXZXN758euapqcqYqKac+mjHiMejYheSFXd3qYmopniXOaeYt0iIpqjM1FIlpTl2Yzp1jpqOm6RDQhMyEhqGj3ujd7VUgzazIh14drV22WRiEhISEheucyt5uZyti5i5mIaGt6aqqqmJmoxuXVt8bWhal4aXhKSUR8aW6ayLqbiI3MbZmaqJWayWeqqHszaVqfSGh7hvXm1kicmHucWObXqGu3h2pHNCFGRL81mqaptzSLV0W4baZnIb6HMzMhISEyxpszeCE0IckzITRFNCEh+r+trklZm5pqWZu97oqIeJeWhoWGqPv6eatGWYhquniIRMuJaYjfrJtDNEVuvWd2a2qJiXZDRYhXZXiri0RE/8rlR3Vmd9mKZMvLZtpDd1SZmsvnqmND90REl79ZU1VDQkRUVIhCmUOoRFNVRENDQ0JCQ5hWQkNEuZaFZ2l6mnppZ5aWuMjHubrKq7mqydjIroppenznqudXQ1hquYy4tpfa2LmHyamaiKtHW3qLxag1bI16Z42KV3qMqqvGjlWtlUl6mjIxjzWHQ9nZiDXnRmg3RTGNSIeJqTLpWDUwMEYzulRGRzBaMjAxuDMwMDAwyKupyZinlpalo7S0tbaod3mKt7ani6rImYedl6eYhaeXm4lomJd7i32WeLiIx9XTlLmHyJd6OCZ5uMqIqmlJm3ebxX2YmJaqTKhnbDsRKmuWZrWaKpi6pZScExFpq8YSERFLZhERFp5/e0oTEREREbkRJooRPY8Sl5eHh5mYl6m6ubi6iYqptbWneZiot6iXh6q6e2hqWSKbqaR8mraXlriYtcemqouUeHeWRyEjIiU7qsfExoqdzKh5qJi6rnuNOZiarDm1t8a4xoW2uJeFeYs3Sm2cIlmqISMhIZokridfup9eISEhISUhl1whISEhnJupl5enqZiZel1ejqu62qqap7a2qJmZf1qZpsa3ltbVt6V3j32ppnuL2PXz88eqinaOnG13elhXiLnmildvqJhoN3iKuDZKicWliSIinZaK1aR3tIV5qTU2IiJZiFg3JEiVlSIiNkhHWYNJSiIiIiJImJ4iIiIimXxsVa2/a1doaEpamq3c2NfXi1dWabu7yrmZu+S6vVVaaEXOR0V5m5q31vWbirWcaqeVfEx8VmVXbcyqqqnVVXhq5oubaEVnM5qWyMiZt8WmyI99t/U1iYkzp3hFiXYyMjJDMnoyMjIyNresMjJZVjIyljIyMjIyWlpKrmt5eL7PnHmKrmp5yOfZ+Kyrx5l4ikeXpVh62Xt22p5oiajaxsjXqbi32piWiLl6VjeHV6hZmbyJadqueIm3p4WJa3qVNFjIx5ZVhland5zaR6dtNDVniIpZMjQyMjJpMowypzLKM8wyMjIyMjIyiDIyMjIy/pqJp8jIfWxYRny9unZmV1ZWeqmHhImrd3xXZmfJaHd3e2rLbN+9nEdojFbZ1pZ0vldYl4hlZZrLWXZ3RXy8SP1pQ0NDm+ra/nj++kNDQ0OGqHZEVLhW2UZouIq+RJqKRPpFi0NDQ0N6RESHQ0NDQ0NDQ0NDQ0ND3quL3d2bZ2dnhoZ3ZmqJmrrb/P78+Pn7aIdnR1fuZ2Wpup7MqoeFy2dmrlW/mpt4p5qKqZhYRXeK2miLr2m9mERCRJtEicl2VkdWWUNCQ0JEeup5d1ZnQ2dWeWqMQkNGQkJW+FVCQkSmeGabQkJCQkJDV1VCQkJCh3doaGd4iIiZiHydq4aYxrbFw8XGqJaWqHbHp5eGiKaYuqinqJp4lJeHrMbSxcSZiHeIeiQRESh+rpqpiMqZa3mHeIqpt3mLtqdtTRFfp7lKezh0yYqpiYokXCcnJ0mrbUoTyRG7ERXVr8RMEWvCE48ShxERERERaDU1U2NiZmVVeJeYe52KaVlZj7+6p5mIaUdUeGqdequPWmpJeoe35oeJ+PbqqK23a9RXj3nWVmuppbqIZ4xouVnl5fa46YaaNEWnp2RYmqmHdWjdeWxXWHfKWVpsiZxJMTHnjGkxNDGNx5MyMTFWReQ2yDIxMTQxyPf39fX19vjqi4ydnK2ad2l7vLra+Ovqmava15aqeFl5eGpkZIipmnyauYmMis93eHlZZkRWQkNoRmpbv2uMalt6vJ9od2mnZlVEdGlDQ0FBQYpFekRXVol7qYpoWFdWVUJDZkRBQUFHqGdFV1VBRUKrao1BQUFBaXt5iHp5mXqaiXyNe4hoaM3r6r3bznp6SEVVVGr0ikRW2qhZZliu3JeLqZe7yqyr28p3mER1RWe2l2fKeWeOZ51FMTKLSFuZ5tV1VFYxM4Z3rWe7rlb05tpEuTLqe2R2MjF5q3cxRopFaVVEMTFmx8cxeDExMTExyt2tVmdnh3d3VlRVVkRFVFdYe0RGeL3uV5vn1dbXfJmM5smHzo1Vrb2aaUZWeml4i59GVaxZesxViMyNqrzM6PfsyOz32MiMmtuau0SNQ0NDVFXImENDRWlXdUNrRUW5Q0NW3VRDQ0NWZY1DQ0NDQ0NDQ1l7Q0NDSXqLf8nIuJmYp6m3p618aZqKN0psr4mZp5l6etS3ulyNqtvZ6LqpjIWKm1ZmWFt69uXYenk0RVari6q3qZuMbNdpieWEpLdYf3dWyTIyMjIyeadlvDIyi/RYMsXkikbOMjKYZqY3MjIyMkc1MjIyMlgymKxGMjIyqZmIhqnHtbW1p4aFd2l5pZeJZ3mKmoeHqaammaW2p6inuYeIh1hrd4W2uYemjptnmZWlp6uoeba61ZibmdXGuofJWpiJmqWIj2yayJk7fl65qHZ0jCmqyBJ2J58TyrRvEYtbERERERFMuyg7EREWbhERExERbxYReFpIa8rMXHx7Wnus9vP1u5+8zM3a5ciqeYyeaVVGZGmZmGlKv72NmZjJ4+bIh3dW9ql1dt10aERYRkeZaYmZx4iFqeeb2YlomtWYhWMxMTFFR3g2eFeJmroyMYaJWEVnRmXFNlkxMTExWTZkM65FMWkxMTFEe4qLWkdnq4l4lpemmHhpe8vKiomIqKi2t4aJTph4laaJt9S3p5iZhYp4tYh6hsWompaZR5mGmbR+ime1lZiol5eZp3VXxseqdpyqxnSYLIaMtKRMxCmns8WFd5t3fG/Vf4qXAU1vTAE/jQJNwwO5XgEBAQEVV3oBAQEBn3xpqLqLRkhqm3h3WK3v/N6dvPn66rvdZ3hmVlbOZVZYiul4rWr6jGd2ZolmVv79eGqaeWV4eFSYjMqrq4u6hXZ3REOIt2T7Z4nbaENDQ0NDVFWKVXZFZleaVkPKVXh1Q0P9d0NDQ0N2hahVQ0NDRERDqlZDQ0NDi87NWXmJqmlpeVlqeXWG6+6+ZmRjg5SV+Nm8it3n6IjlybqMuVmcjXpoZIjKqNv3qadoaKmIy5eInWZbfrnMe1Vqako1aHm+VolZpWh6WEZ12XXJNXM0N2VFekZXaCGGmWa1dpkgNSAjl6WWaCAgRyEhnFggICAgeJeYh4hnd4uad3uMmZuZrY16aO39vnd3h9/tq1h46FVnmYeIVUrOm/vJzInd6FdYm8lJl1QyMjKJV8h4+Xmr94p1dXX63HdWZkZFeFR2m1UyQ6mGeZdqhutGZzJVeGh6MkQyllN1MoqZMlUyMjIyMjNEZ5syM88yVWZmd1hqmotZaXhpZUZHm9fX2rjIqlg1q4t87Hhm6HhkZ2jGzGitvf+GhnSt+IxYl1Z3Q4dCQkJCQ1fqeL14jq+MVEOra7m6zbr6ZURDmob8ebh1WHbq+u6reUNXVXiHzkJCWEJCVkJDh4l8VkJ5dZlER0RCQkJDa2mKiYiqqppnZ1ZWampcv6ubVGZUZ8zfzMa6yMfX5fbkiouIubvPd2ZqVFNTVsxmfjToi0SJWTRpQ6ipV2tcaol5ZnzOnclZebX0ZzKsp2NGRne7ZqczQ+RU94uadsgyMsm4aHzYajIyi0fHWDQyMjIyMzVWWTIydXZnRDQ0VZy/a6u8/a6NWTY2nLe2m2Rki3imWlep21mcZUba6vvJnt+c+pfsRTNYZmhVnKS9M3Z2hXRn+P6K3MabNKaXd5eGRTRVRmg1VmZ4mmereXtDReyb13lpiXd1REFBRGdWRUNBZpV6V0FBQUFEvJ5VaVi3vp16V3qdzamoyun4/O+/fK/v/vz9zsnJVVVVVVVVVZq4uum+VVVVVVVVVVb53vxVVVVVVVVVqlZVaGhW3VVVVVVVVVW/3ntVVVVVVVVVVVVVaFVVVVVVVVVVVVVV3VVVVVVVVVVVVVVVaFVVVVVVVVVVVVVV3VVVt7i4qbi4yMbGx8bHxsbHx8bH1tbHxsbHmIiIh4iYmrnW1r5IRUVFRUZ/ycfGt6i7bkhGRUZMi6vIyEZFRUVFRUVFj7rGqqh8RUVFRUVFRV+4n0VFRUVFRUVFRayealpKRUVFRUVFRUWqb0VFRUVFRUVFRZ1/amlFtra2tbW1pqeneH2Ozc3My7+PW4eHt8W2p5ent9e/x5Z3v5e2xvr7+/nHql12loaZpqaHl6dERFpWekhENnupmKmXl3llZ3aGeYWZh1lERERaRERERI9FRERFv1dXjVueNTY1RDZERES+RERESUREREREREyMREREh5eZaWZmVVZWabu5mJeHqamai5aVlod3ZomIVndldoZWZYz1+qvv/7+6eHqciqxXd4lFV3e3dlVVd6ZY3kZERETbzXhnR41lRESNu2eriGVnVmr/RERERES/7Zt9REREREREREaumZibWkdERERERERE++pERERERUVFVWVWd6aXWFhYVlZWV3Znq8t5RjU1dphoNlZVlpWaiaiWd3d6+u/++2d3d3hmVFRoeEc1l2im/WeIZ3jpzsutvv93mFVUVFRUVWpXmf2HzVRUVFRVzq9Vz/+oVFRUVFRUzoaYaP7+aFRUVFRUVFRUv1RUVFRUaotqaWhYWJus2Le5WjZISWh4iWloi4uLqnyMjWpGVUirrqmqNGpnaax6elgyMTbltIhobVlX5NjYqqlrpqVVZJuLdriNMW3Nqp5Ne2iGVZqGMeTXq8XkxebHxYq41dVHNjHjukoxN5tEMTE0Ma3GMjSX5DQxMTExSlpaWouquMXFxcbV1dm/Xp+ebEpaXltLaGtYRleGl7fF1dTVxrhYfFmPrtXVxceYR0RubXtFmZesxtXGr0RERERFrcXUxLeFRERaRnxER4eIzGmpRERERERERKfUxZeNREREREVERH15io9cRERERERERJrWtnpGZmZnbKzKyLe2t8fH1sbG2Y6dupiYm5uLZkhWZ1mIhZW1xdbW1cl9aYyJrcyprJxYR0WHiJY0NoWYqbnXrjQ1RXlFaMbGxtiXNDSbmqY0NG1rfo+fNDQ0NDQ0NG/V1ZVtNDSKbYo0NDRKjWpsNDQ0NDQ0NDTUxYY0eHd3ZlZWVoiIp8jIe4iHt6inytzLurmqeLrry4mPq1RFd1aWiOn36vXo2Mp3p3l4mFc1XKxl24wzWcqbt5eXlunJjN56ZomaRVdYeGZGZ0VczVl5q55bejKeSFuONGh2MTExaTEyMTRYSDFXMzQxMTExMTOuSDIxZ1Vmd3h3iHZmZXeHuMnZx7emlqaWp5iI2oqtRURFV0VERpz39fX5qcz5mmeKuIjpvFtXWFZVZVVVZ6iPqO9bRES935x9RkSPREa/uui3h3iYeGqtRERERES/yGWbREREREREREaPi59tREREREREREREyLZEREREX6q2taxuTElZOi1et7W1tbW1taWlpauPL6imp6WlpaWlpaWnto2stbW1pYaFhZaZdnaHhYWFhYZ2dYaYqJaXlqaVhXV1Z3Z1eHeXxqe3dlVVhnenh5qsmcnViHZneFh4BQUGL7yol5ipnz8FBQUFBQWfaUd/BQUFeopoR0hZWXqp+f7/752cmpytm5urrXpoVmZmZVVVVbrHzP382/2omq7vyaiqmp2aZWVVVFRUVFRmeJjJ/lVUVFRXu5mveIlWdVVUVFRUVFRorYiYVFRUVFRUZoloaGdmVVRUVFRUVFRVZ2lUVFRUVFRUVFV4eVVVmImHdnl7eJeImqub2dnZurqop7m5paeZV0dWdGNYZnSVxuXFp4lnZYfHq6mopnZonHlVhYdmQ2XtNDn+5ndYaKenybeHd2hoZ2jKOVxYa2Ru9m1HqWVIeKePWHd6Z4SYT3y5jiEhIW8hISEh7WU3IiEhIRSKm7p9bGlYVVZqnXx7qaiou9rZ19jJnJureml6VlZ5rFVUjVRUjazo5/f29vb2j76amYppVFRUVJ1UVFRUjLr3+25WVFbc3vaZiYpUVFRUVFRUVFRUnOtYVFRUVFRVm9qcWHpUVFRUVFRUVFRUi1RUVFRUVFRVv616aFRUV4WFiXd2ZmVmd3ucyte3hqioqIp7v2k4RFhaVmV3aJ2Jh4eL2vq96Pf395+VZWdHZEdliWp8d2Vp5pu3fKqNmXjPqNq0lkdod2qLi2jJrVmXmtrImdw2MjIyN4ibZkmLMjIyMjIyMjO+vflrMjIyMjIyMjKIeUY0uH5NOZ++ubu51dTU1NTU15yLZ568xLS1rKWnfGxdeWiJinuZmKiKmKnIudbEpn2OZoWEdmd5XEU0TKfH1Iq45bmN1KqrNWuHZ2k2NFaYVjU1VYl4eri4yZ2YmmhIMzdIMzMzMzNGMzNod0gzMzMzMzOPfjMzMzMzq5x6iYqJiHmMm2dYmsm7vMm55+jIq56LyKl3l4Z1uJa3uJe5d3isqcvJ2JvqnJjHxsaXuYhomq1bbEmvqYi5ibqJmpinl6iZMyMiIpSKaTMiIiK8WLg6XWyadbh4mGhGIiIiIiLNIiIiIiIiIiIiNCKYWzVHm0Yix8m5x6enhqen19e3d1VFV4mZmoqKmbnImtxnRERldoa5iPbpdnj498t3ZmVmVUZmmFVoRnfWl2hmaad3Z2vf39qN3atGZ3qqMzaPztt5ioqfn5rNbTMzMzMzXN+dV1lYMzMzMzN7aFaaNzMzMzMzMzMzNMdZRzMzZWVlZWVlZWVlZWVleq2tipytvWlnZWVlZmVlZWVlaL6srZu+ZWVlZWVlZWatmpnd/ollZWWJZWVlZf/dZa1lZWVl2+tleWWqZXn6Zb5lZWVlZf/OZWWtZWWZ/2VlrGVlZWVl6mVlZWVlZa9lZWVlZchoZWVl/2VlVnzN3M3NvVZVVVVVVVVVVVVVVVVVVVVV3vrc6ap7u87uVlVVVVVVVldXVVVVVVWM3al4VVZWm4ub61VVVWibh4eJuphVVVX9VlVVVVVVVfyMd9z8/KxVVVVVjIprVVbfVVVVVVVVVVVWevy6v1VVVVVVVVWrzf5p+MuKiJmKeGp5h7zOrvv3ysjKytr6+OjouHlqe2pVVmdVZ3d3fJydzK3O6vn7ipiYqFVWV3ZmrJmMaJxrVmieQ0NDQ6yaVodXm3hFQ5pXy4pDQ0NDa6pZQ0NDQ55Fqld3Q0NDQ3hnVkRDQ0NDQ7tDQ0NDQ0NIRkSKppmYloh6ure3tqmphpaWiKmpmqe31cbHq3taiKzIt4bHxY6Xtcepl23G07e1xqiHhWaYtnd0xItsx4rTqVqdj4xtxJqnbkl6dVd2ZbeYJWhJplymiCEhI29/IYuaFamXOSMUWHoUR1g4aI1+ISEhISFLISsjIVwifu7sm2loZWVlZWVXvaqand6+aVdWZVZpZWXum1ZlZWVlZWWuzvervM77VmVlZWVlZVaPmmVlZWVlZWWfrOna7fn/ZWVlZWVlZVb9fGVlZWVlZWVlVv36/fZXZWVlZWVlZWVpmGVlZWVlZWVlZWqezldlZWVlZWVlxcXFtrW1tqWml5eKboyJhnhpaomXiJqp1dWPvseXpraYqaetp4anh2dXRVe3tdbIbzhLbtW2t7q52MrFmWpbXEd8RVfXybdHMzM0bmu7xbrVx6x8NTMzMzM0bNbJjX80MzMzMzZdajU0bm4zMzMzMzMzM0hXbzUzRWdYeoiHp7emtqa3uJqamWZVaFdXV0ZFfWaZaKjlycjIyNfVxpinxqnY6VhYVn6ci4/mmUh8enmJaHmY9fT0jMw3fbw1vDZryogyf23JekVtWYqKe5o2MjIymr1lRbsyMjIyMjI4i4pajN5XMzIyMjIyMrmmZzIyZFRVVmZlZGRkZXhmZGZp376MdHV5z66MvMqMentXV2ZXVVePzZ/r3Vd8dWVWVnvoqaqYuIvG5OX15lnniqqa2Omv9L3lfebHMzMzNWiZhouol3ZJMzMzNJuYiWiaqZg0MzMzMzaoWjV6iDczMzMzMzOqu5uJejMzh4eIiIh3doeIqLe2xsbG1tbGx6eXh3Z2RUVFRUVGj5iHp8bZ+Pjb6Nnbn8+ae0ZYmUZFRUVFRUl3p9jor0hFRUVFe72vv5+Yl0ZFRUVFRUWOp/dKRUVFRUVFm6y7e814WFdFRUVFRUVFqK9FRUVFRUVFRX26jHxFq115ilx8tbPEqIiYXIqKjKu3tJlqmbS0mp9GWKaItbi1mHiVnGaHVVaJmKioeppsppqJjaeriKeKXJVppqOUmLV+jLi2Wbi2p8pGRBR7qLmapWtspqe4uISol7hfermvFTUDAAICAVeJt4i4AQAAAAAAA7eZSHoEe0ZGVmZVZlZGW7m3p5e4x7qbn4+dyNvPilc1RnhmdWlWW6uf9um73b34yLaGp6fuRVWoelm82VdlV7d7nKaHjLaIZnV1mLc1icpFQkJCWZp2jMh5WkRp6Og3VqtoSN6IQkJCQkJCQkKJ2stDQkJDQkNJvkNDQ1hCh2hrmKempqWltrW1trqcqae4nIiWpranp2ZlZWVmdnmLjq3Wxdan1cTVra2tnqqWmX9/OkyJZWaHh6fWrMes1tbGyVdWdoeKWFwkNiQkOYd2ttVvJCQkJF6qn3aqlnacJCQkJCQkJCdluGskJCQkJCQkvXYmj34kxcja2sbGqJaIZVRTeai5uai7/LuolbbGp8z335hmZZ2pd1RreVW9k6pkg3aFdYOoZYamu2pHNFxUe0R6aJ/4uPiadVZ0Z3dZNUVo9llqNTNFQ89VZc5lVY1Wdo9/RJ9mV0c12o5VNCEkKItFrWZJNkkhW3s1Ijg1eGh5yr2Nm9vsrcvqyp2LaJytipmIqKiYZ0RERERERGmavrpWrM3q13m9z6qYZ5msRERERERERESau0b7WURERETsus2a+sh4RERERERERERGrttEREREREREq7jK6rq4RERERERERERE3mpERERERERERGuoZtpEm0s4OHuIlaWouqemjDopaYuLip2d2rmapabYWUqFhZaox+W/imR3d3ZadpZ6b+bHhYWWJ0x3ZHR2tfZJdXWmtZaWlbiFivjFdWWaI68liK+omDgmhpSm9UzX5peFjbl2JCMjI94jIyMjIyMjbjpqfyM5xn6IIyNquamquuna2brLy9n388yufGpsaGmMucjXNqzIhkbMuLi9rZ1YV0dpi3yMXZtcVzZEpoZ1VUeamHlZd2XYlHWpNoq4pYedNmhlNDZ2lJWElJXJuUh0tpoiIVjNs19FISE2OXVFVolbWpqrhMaXNSEhISKKl0chISEhyr18WamZe83Lh1VGav773PvszZaWeIiYRYhmiERWZnl4VWr7eFrml4V3aL266ppqRL1HWbtFidtYenZV3VioWHtqnLq43KiIRUJBQZncWKdWmNhXm2lrQUFneYbanFRFQUFBQUFERERDNGqsVUFBQUFBQYlm24t1maupucjJyKemlZWVpaanp4aGdXV2hpeXh5eaZqnIx8d1ZanX1NTHmavWi0dHaXmXqqpVdYaFyYV1drW4uouvJiSNunwqbo97T3l3ptXHpqeGh2d5byQkJCS6hjU2jyQkJCQmT7u3aJiKjzwkJCQkJCQkt2xpJCQkx7eou6iXqquLmcm7nYuquLioqIqKWaq5zGlqRkZoqpypq6vPvp28z9vX16iLatb4RkRERERoy9eojaupRERERERERESYaH9HREREREREiPi1ffmvRERERERERESPRkRERERERERERHiYr/hERERERERERERYakREZ63++9y7u8zb+v6tZ2dnd1VUVFRUZ2dX7f54VFRUVFRUVHj/3WZWrntUVFRV/1dX76xXZ1RUVFRUVVnNzWbcZ1RUVFRUZ8tmZodYmVRUVFRUd1iIVuv9/VRUVFRUVMqqeKpoelRUVFRUVml5mvt6VFRUVFRUVXvKRXm7q4q5iWhXRWib3O3NzHlFREREREREu+1GZnhEZ3h1hriYV8+7q/1ERERERHn7mHfIhndERIlGqJaVqu1ojMpEiURqmdtXpryamERERER5RESpiGbPnP7pRETrmnqeemjuRO9ERERERGlG3EVERESbREREREREZGV1d1VUVFRURoiHlqa2xsW3eFRUVERURFR3WIp4/81naYxXV1mv/Yp87alWVERWaTVnWEWavJub6P3fyWbJq/5aaFeKt9eqQ/laebvNeYxViEXO2kf7RENDRFl3Q+9DQ1eai2dEeqxDQ0Wrioq7WENDQ1d5Q0NDzYpnV2h3iayci6q4qbu7vc28inqcrFh7VVRUVKlXVWhoq1i7eXhVVFetZ5xWzld5VFRUVIiXVMv8y6q+VFRUVFRUVmic3ZxVVFRUVFRUVLz5+ex7VFRUVFRUVfj4++xWVFRUVFRUVFS/6qxUVFRUVFRUVFV9+qtU09TVqmV1ampsysXFtrbFxdTV1MXEtcTDhbfG1ZtddlSalpu9hWRkdZR2tIWVlJyLVlhtWZ+Fp2OGpWhVdVa0eUupx2hmZtmJiDuITHdVhpmFqilLJZo3Ok4lpNeUIz1dSzlcpp05byl8PIgkrzy2JW8hI9giTiQ6XI6sucTW1189i51+bTtLm62NbUx8impKqraLf26op7u4xKl7t7Z6tZupuUq0p7jExZqltlmLppm1p5mriaS2WLy1t6rFuYq3WSJpeqmllLSmppWVJCR5d6a1tJiml5eIIiIiIkVYJCIiJXUiIiIiIleFNyQjZyYidpepSGmKqHZ37v3e/5x7VmdXz////7qIeYZGVFRVe3jtqMxGmnrLu82r3ZdIu4i6h4fJRVRUeGaXm0VUvXeWVlSKu2dEVJuGuUVUVFRF7GWFVlRo2peWVFSaqLpXVFhnRFRUVFRUVEdFVFRUVEZUVFRU/0VUVFRU67mYibmYuYxKVmd3m8vceLzcylczQlqOu9rYZmfnuJlWRWfafFZ8m1S6yrxHRotmuHtESETJiat6Q2d6Vqm6qtlFn0PnQrvLm2eJeGbJeLpEQlhs9/V6SEJCQolYm3itikZCQkJCREJCQmhG6q3IVkJCQkRCVkLL+PP09ri5dVdpz46OaXip3Ly76cqbWXiaQkefy2hUREXajZ9aq2WIeseppVfY9XyKvEdavMnJeEloZ6lSVEuKfEa4Zap45Zl5aJojWXiVpnhnRml4ijNENG1GZKp8V0OYMTExMXiYMTFWemaZMTExMUSst2dVimZVtMPDw8PEqmlpaau7i4mIiam5qGt8tbW1w7Ooenh3mqe5mcXDw7O1pnmJxdSnaX/FKkdYSX1qWXdXTHxpfKirq6e3tLm1mJyIWignS3RpTVo4xkd4ir87X7h4uJi2w5pmEREREVxbEhETmEhaEhERERKri362Z0Ym3NyrdoaFhZep6+rq2fr5t7fZ2cjJ/JiIWFVTjGxjVGaId5mLisi5mKmpuZb6qKyJVWp3eKysjFtajGdUWIlXdXetppt1y3quNDM2M4iHlmpZZUSMTDMxMll9enV1VbyVaTFEMTKNMTR7MVZ+R2g0MTTeMjMxyjMy59jKu6ysq7mpuLq8q6vLydrZ2cnKqbrLjW1qesq7jJzH19ibvLuqi2p7q9jKm+eqWUREVkVErFh7rJ1pr0RERERERFjnq8lEREREREREREREjUREa0RERERERFfKuUZEREREREREREREjURERERERERERER9x0REVVVVVVVVVVZWV6rc3N6cV3iaq6uaV1ZW3GlVVVVVVVVWef9nVVVVVVVVVWfPmnhXiLn86r5VVVVVeGpVVVVVVVVWvXjbm7mZ2Pr8/754VVVVZ1VVVVVVVVVX3frd67p3rVVVVVVVVVVVv1VVVVVVVVVVVd6sznn6V1ZVVWeKrGdVVVVVVVVVVVZWVVVVZ62s3MrdVlVVVZtVvou83ayKzf7O71ZVrHjeZ2iJi1VVVVV5qan87VVWjf+7yqhVrFZVVVVVVVVVVf/8VVVVVVVVVVVVVVXrrFVVVVVVVVVVVVb9VVVVVVVVVVVVVVXdVVVV3Xtod4eHusuaibvLqXl63MrKmmqc73ybrFVVVVWamIf9y7vbm1VVVVVX/939at/aVVVVVVVVVevumvxoVVVVVVVVVVXsVlV7VVVVVVVVVXq5uFZVVVVVVVVVVVWtVlVVVVVVVVVVVVXu/1VVVVVVVVVVVVWdrFZVmLe3qaq7mqnJ6bvLq5ydrIqYuen5uae4ycm6yr7MjmiuepyvvUdqvpvJ2Kjadqfaa0RERGqKj0RFRVbIaldEREREfNyYtr1FRERERES8nFdWRu17RERERERERETX6EREREREREREWmhERERERERERERERETrRUREi2hmZWVlZVdpva17VWVlZWhoes/vvZl4rmVnZ2VlZWVojnplZWVlZWWO+/vMmv35rmVlZWVlZWVlr2VlZWVlZWVprMrdzN3MZWVlZWVlZWVl3GVlZWVlZWVlabz7zPq/ZWVlZWVlZWVl/2VlZWVlZWVlZWnt+mVlvLvK2Lmqip2866urmsrY5ujKy6m4upmYusmLfdp8rK6M27zLbFfNbGm8qtfHutjWREdERUSqi0RovkZou0RERERERHvnq9dYREREREREREREjERERERERERERES5un1EREREREREREREn0RERERERERERERruI5EV1VVVlVVVWd5u/3dVlVWe1dmitzcinho/q9qVVVVVVV4u6xVVVVVVXieVczLm6qvr/9VVVVVVVVVjFVVVVVVVVW+yu366+28VVVVVVVVVVVVjVVVVVVVVVVmzcv57PxrVVVVVVVVVVVVuVVVVVVVVVVVVY36+WhVVnh4u/3ti2d4fOzcimdmZ2does/fe2dnrbtmVFWci1VVemhUVVVnZ2i+aIrs22iszVVUVFRUVFRVjFVUVFRUVFRX/Mvr7Jz5VVRUVFRUVFRUmlRUVFRUVFRUzM2rq9/9VFRUVFRUVFRUvFRUVFRUVFRUVHntmPxVuquseXd3isvN7s2rm4p5mbm5ybq6uot6VFRVmXlpq4qtrPp3vlVUVFRUVbqImlVUVFRUVHi/nf79+XqtVFRUVFRUVFWoVFRUVFRUVFRXzGfNv7tUVFRUVFRUVGjdaFRUVFRUVFRUd7mtrVRUVFRUVFRUVFXMVlRUrM7//v/fzIt83NvIp4l6VlVneImKu418x6dqaGinx9z//4ybimhVVVVVVVeKq2z9VVVVVVVVZ8t476xVVVVVVVVVVVVVqu55VVVVVVVVVVVVmVVVVVVVVVVVVVVnyutVVVVVVVVVVVVVqlVVVVVVVVVVVVVWrFVVrpx5Wczru8zs+r+NiKnruYaGmezqvGiaZsxoZmfvV9qIq+z7/VlVVFRUVFRnyn2bnrxmVVRUynjfmndWZlVnVFRUVFRnemhWZ1ZUVFRWaHhUd1RoVlRUVFRUVFRWrXj/VFRUVFRUVFRUV1RoVFRUVFRUVFRUqf9Wq3dmZWd4ZWVWqsvc775qZWRkZGVlZmdo3Xd3Z2dnZ2RkZIj+/2RkZFZnZ3l4i3ir3815zs+ad2RkZXlmZGRkZ3mbZmRlvHqJZmdnZ6vs+2RkiWdkZGRkZZu8d2VmZWeaZGRkZGRnZ/9k/2RkZGRkZGRoZma7m2Vkinp5eXl5ZmZlZWVlZWVlZWVlZWVlZWiJmv///d///ctmZWVlmWV4Z2WLd2VlZWVm7cze/3mpit95ZWh4ZWVlZWWJeHdlZXjve2VlZWWKeHpbZXllZWVlZWVlZWdmZa55ZWVlZWVlZYdmvL1lZWVlZWVlZWeIWX15V8z+za6/mszt+87Pe4y9/Jxqmb3f/Yt5VVVVVVZVVVap24tWVVVVVVVVVau7uc1oVVVVVVVVVVVo7VVVVVVVVVVWZqvLytxXVVVVVVVVVVVW/VVVVVVVVVVVVbr66otVVVVVVVVVVVVV61VVVVVVVVVVVXvamMxViXmqypp5eGlpq97dmmdmZ2iavOzteYp5eUREREREnrlmnWea/0VERESKqLv46HmKRIm667loRH54zodanUS5zKhmqNn415d3rldEV4pERKzIZvzNREREVFV7RERERWdERERERERERET6mc9EREREREREREREREREiKq6yNfZuqub3MvKuXt82suraLzauaiYmmmcaldERZuaqny8WkRERFi9qam6nqrJi55EREREREXL3UVERERERERYvYm63MvIikRERERERES8i0REREREREREeorp2L1pRERERERERERErkREREREREREadeK26v6uYmMjev52mlmueq7mou8vItYVzI1r9vsqLmbut01Vnt3RUU0RXZYeFZWVZtpVXa/Zsd6yzVmRMrmRXlERHabm2l7RGmKert5VXWoRESZikQxMkN5V3aqhojJMTExnbeKzFac+PWIMTExMXrlV6l522g0MTExa8jYVViMilVUVFRUVFVVZ3iImZpoVVRUVFRVeJz9/s39VlRUVFWKvVVVZ4q6i1Zn3Jl5/f38Z1SrVVRUVGZWVFRU/VWd7Krveld33NxUVlZUVFRUVZxUVFRUVLxp/4zsWmefZ1RUVFVUVFRUiVZUVFRUVFRVWM1nqr38eIdneWl7a//9+6qJz+/vu/v8nFZXqIh4Z1ZWZ2Zmqcp77P3cat9VZmdniuuIeGd4ZlVUVFeIzWZ3VVd6rFRUVFRUVWi8eHhmVFRUVFRmZnq5yv9UVFRUVFRUVFXfq2dUVFRUVFRUVd5VVLpUVFRUVFRUVFRnVVRUrZyLi5yrmczNz7+sm3lWVVVWesvIx9rb+f9YVVV6eoh5eotna51VVVVVVVWd6Pqn/1VVVVVVyFVWZ6pVVVVVVVVVVVVV//r5VVVVVVVVVVVVVndVVVVVVVVVVVVVn9f/VVVVVVVVVVVVjFVVVVVVVVVVVVVVn/hV3bvN7816aMz+3GZlZWVlZWVlZWib/+7+ZWVl/HqK7Gj/7mndZWVlZVVlZVes7npGZWVlZ3lnZf7/ZVZlZWVXaP+JeWZlZUdWZWVlZWVlZdqLZWVlZWW6VmVlZWVlZ2hlZWVlZWVlZVb/ZWVlZWVVeWl6mburVmVlSHu+/d/NvVlIenmKellHaIl3eZytR0RDZ5c0MTExMnfnp9tHZVZn26qdV0VFmvmo39kzRq54VohoZ2dWyIlFe2r5qIfcZoeWaWlWiHf2ZHV2md5UePqav2lrRGdmZ9aZQ3jGhrU0RFat2tlUdzIxMTExMTHKqUO7VVRVVVVVVVVVVWZnh6fI+OnaqXhnVVRURERERUVFREU1RlaJd3Snue6GdmVVVUVEV1VnnHhlVkU0NDRWean29va5dopFNDQ1dXaI2emIZVVpR2edaHmY9PTshWdFZldWmr+Pb6+Nh4eHrZiZir/fv926i3l8nJmsZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlV/+J/axlZWWK/IvfZWVlZWVlZWVlZWVlV6nK/85lZWXP78yYaL5lZWVlZWVlZWXP/2dXynplZWVo/UaI/5p4+4tlZWXO/ZzsaZxleWVlZWVleGa9V2h7ZWVlZWVlZWh519jo2558aY1rRmmJqJaWd0VEQ0NEncfH6c2taVaZi+5r+kp6l7eYpXhXRkREaKn6eNZnVo5r+0NaRYp/qIjHeIaKZkZWmY6Idnd3bt7o2EJC94qultmraNupVUKJylVFQkJCQkJDQkJCWYmerUNCQkVXQkJCZ2lElYeIere3mJSkiml4mZWUtcTFtYR0aHiZtaWlpJOks7JumLanh6R4h42IaIeXl6mInRkoWqh4aqmrtKSzpcOptpi1trbEpKVvWVoGdhZsc4eIk1eHXo+MnZumxbWoeClXCwMtp0w8AF9sGSyJAGzFNntuA5mHd1wJibjH1NbW19bWt6iYZ1hoZ3dnhneIaWp5qreIVlZnd5jW5dh3acnWt3VoaXlmRn+fv504r3dlp8enmednmfb1p5uv2WpVSUp/RzNIMjR5ZllmeNi3aL5fMjJb62hGSlmKNo9GMjIyaXh4loedNjIyMjIyWKpoMjIyVFRUVFRUVFRUVFVVfZ2MiXppV1ZWVFRUVFRVVFRUVFRUVFXN3Muqq5lpaGeaaVVUuurNnGZUVFRUVI3J+P7/32ech2p6aZqKeVVUVFRUVFRUeIr69/+vuq+N2nmIiGloVFRUVFRUVFRViP9rZVRUVFRUi5lpV2lVi1lHRWiazYiXmHd3d1dafktIV3Z1ZXeIiYjqx7e2yZZlnGVWfYnJyci3iKdIdXVVx/mOM0Uzbq2WZ3aeyPeM3s2OZ5euZnb5MzMzMzMzMzPvd4WHW3zGu87Jibp1msj8MzMzMzMzMzNHu4hZMzMzMzOOrJh4hkcz2vz83NzLqldXiHuujoenqtnp6p19ztnJZ1ZWulZWqWdZi5nauqx8qLjfm2ep+Gl4aFZndqxoiGZXaIuNmopWQ0NDQ0NDh/2IZVZDQ0NDQ6t4WN2bnENDQ0NDQ0NDy5pGQ0NDQ0NDQ0NX/7tFQ0NDQ0NDQ0Vpp1dVeYyMioqs3a6dV0RERDRFicrJ2qipqYl4qYmdiJmqya34+avNRprN+PX76MmJqamtRURDVkR6ukRDQ8qqy826q8p9Q0SYdppXVUhlSFhWRENDQ41aeZ2om71DQ0NDQ2hFWGZXQ0NDQ0NDQ0NDvIrmq7tDQ0NDQ0NDaIeXaUhIV2qLuMrMvY+NzJl3qsutmpmKfDZpVlVoR5altdXl5eWvupqPzouJdniZRIinTpaHREaVmbrM9M1EREVGiefo1raKREVkW3WIRESWio9cykRERERERNfl1ZZERERHNVdqRER8jppoSEREREREREnkx3dEt7yOe5uarKemxra31sa2pnh5iqeXlqanuLrWjyMiIiPPWUaP2riYl3dqh6aIdoipqbnW1jYjI6y4qWdVNdu2qGept7iXaWiIOZbHtyNOvLysrZdqRkXGd0i1t3aKeahYIiMkSyIiIyIiIiMjW3gjf49tNyMiI4l6V0VFRFREQ1VmZIeYjXh3h4aWp8a2x459jXlVh3a3xrfIyZlVdpy6utO6q4nI1ay6vMS4tl2prdPT1J2Zj9TEqWmIh5aHhniNIzR/KWdaqHV2idScRmlvJ4in1MbVyUV/IkkiSEpWKSIkR3U/JU0lJZe4JSIifYoiZHSGirq4yba1yqmopZaVlaiJVVRUZFVUucioiFVERHZ6i4mGuLrJqIuJbXusyrfIaUzHi7iYhZWXx8a51uWeb1labG1/bUdcJLh8W56Xx8Z52bpJRbgiOiO3vNLTh0wkIjUiJDY2I0dXbG85IiIiIiIl1LmeayIidXSFaGd2dHZneKqYipqZmqmXhWpYRoeGdXWFVmRndXWGaFiXhYV1ppf/rVaFdXaGVnaGZXhVVkqZpmSaZVff//++V4R2dWmHWGZ3ZmZqV2X/a4rJpr/+lvz/hXZHhlhZSVZVZVRGRkVlRlW5jTdDQzWt/1lIQ0NDyci3t6m6qJeXmIZ2ZWVlVXd3dYaVlre3yo98mLmodWSop6ese5mKVFWqVVR3hqnWto4UF4iHqJaGtsemFhSOl6WmlkR4eqaYXxRfX4jWmJaoyNdvnBUTfLfGpXWOFqmmExOqE7i2PROtpqYTFBMTEyu4pn9LbRMTmodmZVRUZWZXvfv6zpp3VmZmZ4rL6+vbRcxniLnd7Yeam1jb6YibzN55aEdYuutoQ853mGibvYereZh5uZmKVni5m1dWm3pnRHmamndXuaxDQ0WrRdubVL2ty0NVQ0NYQ0dDQ0NDRkNDQ0NDQ0NDQ0ND+kRDQ0NDlpeomIeGlpaWl5eWlpaWlpaWlpaWlpaWpqeol5eHhpaWlpeWlqimppaWloWGlpaXmae2l4eHiWhmdoeHibe2p6ampoaWmYiJiKmZiXiKaGmMmpqIhri2pqeotql2jXmKP5mJel8GBQUFBQd/iKhPBgYGBgkJBQUFmoeZvsrIyIeGl4WFdVVZv8+u3IuLVWZndZtWZnaIZXzotaeW7celuaeVlbqWz1Vln4taaXnKx4Ro5cXKt9qGdpyHnJtmdkVleCclIyMkI0+XmsznyamNfHtnVGh1ZrxFIyIiIiIiIiIpmPq+JiMjIiMkSYpWeHgleai52aime32OjYy7+cfHnXuefLvK18qrpadFv3c1ZVRlZVWcpmrIaXZ1y4n3ypjHNjNb3ahWRESJZEdo5ad613WXlItYVMX3Q0VZizRZl0VEeVZkzc9Y9HqEZHg1aYpWVFRVnVl3MjExNTU2VXo2S+6uSTExMTE0Z3Z2V1h6ubS1hYWWtqa1taWUpKSVhmloiKh3hYRlNxVtlaWkl3vEw8PEp4mIhJWolYempLWGVUh3p3a3mIvEtbW1xJdkZqaFRle2mcVmVnh2SZioVaV4uah6pcSJl7WlGpg8Hz8/fR8vC4V5PC8NDCwLP7U/hys+eZnImFdXNWl52sioZWV1laWVpaamdWZ3Z/pERmicvHaHWahUVFp6WM97q6mFdXl1rIlWZUZ1aOvZZVb7VWe7/Z5FQ0NY2naGzYqtrcmLu0NDrs92Q+ym/+9DQ0NDRHaLrGo0RUNDi0ND3UOLqbpUbENDQ0NDQ1Zqind1V0harKq4xre5u39/m4iHqqu6x7uselZoloV4d4SltcTG19jHnLm8yaiKeotnMze2j8W5M32HqMm71J80MzdLqsjMyLeIMzOGiJSmMzN7bF9cuzMzMzMzM8fIxJY3MzNsXJeLMzN5fXtGNzMzMzMzMzrUtXYzipeHh5WGnH58imprjLe1tbW1t7eomZubdYdnWGx3V4ibuJi3pam1taeoqLe2qLpth2orJiNfarmcpsbFtY8kJH+1tbXEtrZmqSefJCMka3l5tbXEuiMjIyM9qra1tKd3Sm8nIyMjI32ImaWoKiMjIyMjI3q2t5dJZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZ7+daGZmZmZmZmZme3dmZmZmZmZmZmZm/2Z3z2ZmZmZmaXudr//MZ2ZmZmZmZmZm/2ZmZmZmZ63/aWdoZmb/u2ZmZmZmZmZmaK9naXv/v2ZmZmZmt5mJhod4eHl5ZmZpmqinpqalpsq7iZaludfWyJeHeHlnj0mHeoqHh5iqlrfW2bbWz17m5qiGZ2mbnb9+V0ZZj1Znh8nW9tj8MzM6t6d4XFs5p5tqbjQzMzM1n5bZMzQ0MzMzn6c0MzMzNJ00MzMzMzMzM3+eMzMznayqZ3eHeGlYrHlqm6qqq3p5nO+9jO+tVlRUVJp4VIpY33q9VVRUVFR6rGfOeL7vVFRUVGhoVHd4aM5XVFRUVFRUeIj8mndnVFRUVFRUVJjJiXhVVFRUVFRUZ+75+utoVFRUVFRUVFd5d4lUVFRUVFRUVLu7+PpURFZ3l6WltcTEtKand1dHW1ZmZWVVNDQzjItqeYenqbepqqqpqsXEw7jFTDRMx5+srsOjlZeYxcPDxJukX63FqKR3hpaYiXq0OmiqmWc5mGVlhsSdrCm5KXimw8bFxzVvFCZuTSpEGhEmOWYdEhJcTIenFF+sbpwlVHd3d4io1cbInZx7ZGNjdYWIekdDU0NDeIp2VYjW5eWmiFV4ZZ+8inlYe1d5nZq7y4eLncqlpqW51bm3v9yKS1hFeURaSWqIa6+62Zl/2MmI57c4qck3NzM6uOfjmZ82IiJaN382I0RWaj0iIiIiRjQiltbkdyMiucbFtrbGq7ioqri2w8PEtsXEtqmZqJyeiqmri3yKd4iHl7i1uKjExLa3lqaVh4Z3V5x8aGqNaGh2l5eJfYq5xLqqhpa3l4ZlezwUExMUKZ+bpol4aY52f2t8ZYm1p3hWExMTExMTExOOtXsYFBMTExMUXXV/Fm4UjYuKeWdldHR0ZXp7Z2VkZoiYtpuLZnh5e4vKrUtmWGZmeIeIhniKiZnGxMW2mmZqjL9pdHV4x9aojXfL1ptldpizpbWGdnRoVFhUZHWL5fbWvLb188dbbz/NyJVlZFRTmjsaExUWFhZ325v0rRoSEhISE71kRFxpl5eXlpampqamtbW1taW2taWlpqaml6all5d4eGd4iKalprW0tqiXpqampbWmpqaml4d5p5Zoh4iWmpmnpZe1taemtLanmJiYVmdnh3YvZ4Z6dpentZeanx9fppemiWdnLF8GXAcEHAQEGk2fTwgEBAQEBBkZTx4vno+bp6mbjJmotqiJipeXqJiHlpmMq7e4pqW2prbGt8adqZybnJeVmWy5m2iZp5imp9i21tbZt8fGf3+nb0k0MzZZbIaKtqfIfjMzMzM6ysmmr5xtMzMzMzMzNGqJeNWGMzMzMzMzMzXNnUwzMzMzMzMzMzR3mHY0ZVZGaKipV1ZXR5u6usjY+PjquJiquop5V3vPzGdDaTaai8iLlp6ffHpH2618anp3U3lWd49WVkN53mxWyphkeGg0ZleIQllIxclKZr2I2enYyZrV1btYjFVDRbqoyrqmMTNmqJlEQ0MzalYxMjExMTExMTNUMUPOWnx8rKe2xrO2mLS1w8W1loWGZ4iJhnh6aoiXmlpraGiIiIZcnktbXXiXiHdXeFZIpbajwqWJd8LSmTrDpMV3ppV2dneltLeXd2vEm5ucSaS1p7PEwrWEdZqWmVuNpcPEfwonK9UXAAAAOIktXwgafF0/R1w9B2wrdnNjZIR1h6qrl3NjZHaFl7yrdpiJqYmIQ2SnY1Qln1xqS3aoxrqqyKuGmKaoils0m3ZmVhY1NVY8JTYlqXqHm5h4WIbEgraFp9QkbCptZnmmmZSSVVZ01IioeER2o8aEBJnHjLucvn3Wx7bolKzGv08fzY/bDQAAV1ZWVlZXZ3d67dfWqZeWhom6+Ovb2J5svYx5nIqaiJeZz/fn6OuZaZyc3cl5mMupWVRURmt63chmeanMRVRUVEdFjt+OZpl6VFRUVFRUjKqomFlUVFRUVFRUVPu/mFRUVFRUVFRUVFS9RVRUVFRUVFRUVFS+VFRUdnd2VFZmd5mqmYenqHd4nXtoV2hqjXlnuWdWhmV2h3ZVVWbd9fX4yrncis93ipi8eXZmhoaoZWZ3ZpWZafp/RJ3Memh4Ro/fRr2YVop3ZmapZmn7WkNDQ0P/h0W/Q0NDQ0NERn/rVrmJWkVDQ0NDQ0NE9rZDQ0NDvaub2Mq8rPj23HZ0ds3q99ytZGR23OnaRFR3zIxoVGXNm2RERFRn6YpUQ1RUvNpVe+9EVVRmZnVUZ0WdZZicZmVTRVZYVlVWqzRUWdxnl0VEVWd6/ZllnqlmZu1YaVaXNUV3d4hXjkZne3a8RUJE77tVQ0NXQkJCqujn2929ZmaazNnoyqqZyNjZ2efXqnV2Q1WKm5plVVRUZ+tTRFNk2NdjU2XniURENDR5vc1WmmhWaIxEVqZ1VdlWRGdoRFdmmotsd4yfeJ+KeI94m6+Kq7/LuFbImGmdMjJGRkYymDJIM20zMklqMzM0ujNoNDQyh73c6s28loWXzPj4vb3M99rMy/fo25iGVVVm7HhkZGVlna5lZWWK5rxkZHbqqmZURVZXjFZnRY5XaVRWVWtlZ2VURFVVRURqe2dUnourVFVVWXdYf6af9/N2Z3pXelZ2RENDQ0NEallHRENDRkRERG98uVVaz0NDic69dKnZyoZ1mpmIqfvqvPv59vf56/npVWZ0ZWVUVWZkVXZmZWV2dlZ0y2RVU1RUijRERHh3Z3aNRGh936iZnHpTRGprnVZXiEN3ZUVFiEVqe2l1np+7mq2viUZ1h3hGMleJZ3dmV5mJe2kzWEkyMjSPjK4zMjIyicy9ZXeZ6LmJdbvbqtjm9fT09fX05tfIRFZldoZliGRmZmZVU5tUVIl16GR6RFOKRTVGzFR3mmdFaXlVVchmh6pWVkV5RkZ4mot/iI2Ph3+LeZ9nma2Mm6+8t0W3l2qcMzJbSW0ziTNqM78zM41GMzRFqzRHNTNG2bu7zKq55dm628zL6OjZ6Ojn5tjp2snnelVVZ3ZlzWVUVVRVrGVVV1Vm3GVlVlRnr1VEVH+Li1lqaVVWV7+Gvn5aZ0VWVUZZe1V5emV3Z1ZEdnVVVrma3fSohUeKvFV1Q0NDQ0RHrVtERENDQ0NDQ0p/m2xGXUNDamyP7u3M/bvLvnpmeWqNr516mmZnaHZ1ZmRVq3X6WXVkZGVmZWZ5aWVm/nV0Z2Z0aJuui2aJZFV664f8VlXc7Ih5ZVRkZWWaVHhUipxUZVbpVVWp+Yr4u4bfVFVliGpEQ1VUZmhXRHRodYeqd0JCQkJJV0NCQkJC7Pz93vj027urzf/PjVVVVlh6SGlWWGlqVWZkdlZW3kNTqmdoVmh573tV/VZVimVTVVRn6npUl1dUZ2h5VJpH955peVVmQ0RWqId6hpurZYuJdq2Hp5mLiNy4x0S5mHibQlNoVlVDiEOtQp5DRERnQkNCuUN3U0JUa1VWV3uMWFdVWWpq7e7uzuv39Pr7+759ZmdoZlbbi2dldnhoZnnLrmZEWfhmdoeJdWWJZHZmv1WsVFVq7FdkqY1oaGVUZ0RUZVhEVKecVWZVQ6xT15q39vOpp1W+vFVVQkNCQmmtZVW+i0RDQ0JCQkNsZ2lXekJCm9ro+NyqZoir2+f4m5qq9ujLy/foq3R0Q2WKnVVVVXZUzoxUVFRn95xmU2X3eVVURFWfSEZsV2d2eWqoVEjLmVVEVUVVzndVanZURERpib16vennmVhGt3nZV0OLimh9QkdqRoacWENGi4dvQUFcTUJCvWdCQUFBuebm2cupZJm72eXluZiWx+bXyOXluHaHQ1SpmYdlVjNDabpDQ0NUyeVUU1TluUREM1ibrYp5m1Y0eYx4NLd2l51pNEV6RGl2mnh+d4yfip+Kd394m656mp+ZyTW3m2uNMjJJR0gymDKORVsyMlpoMjVGuzNrRkgydZq75tm7havL5tq8hsva5dnLh8vZ18ysVFRl23hkZGRm63ZVVVSK5axUVVSd2HlUd11HV7+3l1hqaEU1Wp96V1RURFVXVkZo6VicWYtHZEZFaYdFW8ac8/SnnWh6qlZmQ0NDQ0RGqkdEQ0NDRUNDSn+PZ2tr3kNDuZaFhrnJd3Z1ZXaFhafIuMjX5OPj5MfId6ppZ2d3SpdoyLdalrmXp2eVpoV1dWVV2oq7a7xeuJpXmttGirzWuVd0ZpxGuI6HiFdHmYhmSklZaZt2nLtv2IzGaUcnIiOfIiSfr8dIIntnSiUiJiIiIkucjyIiIiIilrqpdXWGx8e3hae4x9fW5OPj5OTk5ce3dYiHuMWnlpSHpoaFVJlldKiWx3SIVGR3NFlrrpeofHlpSXp6Vren1opldnh6RTW4emteaW2Pen9raW9oebxujK+bqUjWilqOIiM5JSYieSONJE0iIm0lIiUkjSNtJDc1x8nIubjH1rmpybm5x9bIydbW1NTV1tbUemVViYl1umVVZnZmmWV2VmV1yXZ0eGV4u1w1VY+amGx9hkZYbYqntI9uV0VGaFda2VaKaHh5aGo1iKhHfZmIvOO6mG2XyGhmMzIyMiQ7rCczMzIyJTIyMz5fmn46nzIyp5aVlqemp8bFxLa3ppeXlZaHeZmppqWmm4iHm5xXbai2praJmYd1Zat/t8TEtbTFpIyMiFh4V42WiHhnV4t3V4jFxMXFxsSYF3t4l4d5mT1/FamGeI6LiZnFl18TExMVExOvuY0sExMTExMWLKg+FpaPnxMTExMTaZubRmdmVmh3dqnJyKentbW3iIeHmIh4vduKRkRERWbZqLt8aazd37+bert3WUfa67zcRURERHar279ERanN3kTnRkRq21ZHVmdGRERERIbJ2EREROvvi0RIvUZEzEVERERERERERIiq+kREREREREREjJrbZ0REZWVlZWVlZVZYrMnJ7P3+/uzaydrbnldWZWVlZWVlZWVmq/9mZWVlZWVX/trqjWVl/65WZWVlZWVlvWZlZWVlZWVlZfvoWGWvaGjMjWVlZWVlrFZlZWVlZWVlZZ/Zad57ZWVlnGVlZWVlZ1dlZWVlZWVlZWXMjGVleItpR0ZHq9jmvFhHjb2drsm5d3ZmSFZmVjVFRmR0iLXW5vT0vo6P2Lh/WVVoOK54jUdUdKa01Ya21vX2u4+Ml79qaEk0VttIWVVKV1V1h2VkpuX05TVDy0dWijVFNZhXQkNWfHRGZ1SXhpWJQkJCQ0dta4quv1dCdXWFhXV1l+r6uqipmv7+rNr6zL3t+6uYq4eGhoZ1hfuYvO7MloaFhISX6ZeXvdypajZERY+Nhpl4eYd5doWGhYaF7IaJd3xaWEc0NFhWNX59V1hZV3w1SaeohoZ4WTVGMzMzMzMzR1htMzMzMzMzMzMzb6xmMzMzdnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dnZ2dmnv//+dd3Z2dnZ2dnZ2dnZ2dnZ2dnZ7/2t2dnZ3/+52dnZ2dnZ2dnZ2dnZ2dnf/dnZ2dnZ2dniddnZ2dnZ2dnZ2dnZ2dv92dnZ2dnZ2dnb/dnZ21dXUxpeWinhmZXt8u6yrucbVxcTE1dPTlcbWxcWaxbaGZmzHW3l4RWarqYWlxcaIZpeJSFqHqdibjFdImluJt3h+x1eGZ8lGJUtFalVWtmZtXkd4yzZJeTS/nH1FN49afjIyrls0WDcyM241XDMyvzYyNJsyMjIzuezdn73N6eysWEZVVFRURWqc3PzsutnpV4xXefxnjFRUVFRFiZh3qaiqrd3Jl4dYqolUVmdnVFRUVFRWVljJ3d6t6tunmZipuWtWVFZoVFRUVFRniP98VFRUVL/KaFRXVFaJVVRZVFRURVfJWFRUVFRUVFbLaFRUl5aWl6amppiZZ42enIuJeZyei2ZmhoaGpsfFxsbGtrionpm3qJeml5amhZqGhoanqX6cbbqouMa4uLbGxce3t7W2ppaWpqioJCQkJCQlTY3JqLpObyYoJElvjqaXxq1LJCQkJCQkJDc6byQkJCQkJCQkJJ2mbyUkaEVFVVVldWVlVGVldoaGdmd4inhnaHh4iHpaaGZ3dndmdnaadrr93c/sx4V2iGV2eIZ5p6bcV5povGlJ/7m6v/j1uXZlZ2VVVXboie9FREREWERZV4hnuJaplqZrqleXSaqnakZERERERERERszdn49E30REREZEp5eWlZaGdmyPr3eGl6ent6emp6utjYeHiNrX2fm6lph/nbj5vIuZnHr6+8ermHaZi0ZGRUdYnvqK2/meRUREREREjd+pdnd7RERERERERb7I6n9FRERERERERFyqZapEREREREREREWNbERERERERERERESXd0VEaVVVVFRUVFRUVFRVa5mnlpaWlpmZe2loi1VUVFRUVFRUVFS/mXd4aWdnWVd3e414mVRUVFRUVFRUVG14mMjb+8m3jXv82qp6mVRUVFRUVFRUVJfG/du+rb3LnvnP6/pqVFRUVFRUVFRUvvj3fFVUVFRu++1ZjlqdVmh6ilZoioiHd3dnZmZmWM/+/e6ceXtqZolVeXepadyIinaqiN76/fzZbGj/7P7uZmVWqEZmmXZF3mV2VZioZ5i4m6rdVYqqRVVVZkVVeFRVuXibRYiri1hHmld7V2dGU1NTU1NTeFNTU1NTRFNTU1NTvVNTU1NT+v3emXloh6vN/PzumIeHlodnZ3mZi73eiGlVVout3Xm9vvi+eez33HvMindlZlhnVnd6VqxqVVTbi7yZ3dmNer/7VlRUVIhVRYlWilRUVFRUZlXM2lRUVFRVVFRUVFRoVVVUVFRUVFRUVFRUVlRUVFRUVFRUVFRUqsW4m3qJtreoh3yNjpqcqLm3tsWpuJicepqZt7S5qae1tLS1tqmmp6qLjZpujJeopKOllJSlw8PDw6aWXT9fX32mh2uXmLSjSkl/nEUoh2V2ZaWXOzdrWzh0prW1ljgpEmw5SxVEFhITEmYpEhISJhXEfRc7q1UShYWGlpiZj1pXZkdKS3uJlpaId2RkZXV0ZYWHybx2VGRmeFdVRl22tcWVhoq6WkRUXFVVdYiGmHiuqKmtq7aa5NVsmLi2RERndpu5mai2qsebq8fWdW3k5qePGZnld3eWTxMTEy7lGRMTExMvyIjW5W8TE69YtkapWo2tjMzL2drMzdnJzM2de52snFZGnXpYWEVDQ0ebRqxqa61Xq5tEREaNV1lXiWmajXpDQ0asRaiYmXqMQ0NDQ0Obusbo15uLm0NDQ0NFQ9epqKhHQ0NDQ0NDm+fm5ubGQ0NDQ0NDQ9rHuMdDQ0NDQ0NDQ4l6uOZqVVl6eIiYuLq5uqiHhnlqVlRUVFRUVFRUVHyoyvn//sfa6/3/ypaKVVRUVFRUVFRUVJ6bv7ycznZ3maqm2P+oWFRUVFRUVFRUVM9Yz55oeXhpWm3MuMz+ilRUVFRUVFRUVFS8e3qHVVRUVFRUVEeY21RUVFRUVFRUeIqsnLy8qmd4domb3e3Mre7tzIh3VWVlRERDNERUvfzs/Mp5Z3hYie53mq3c2oc0eJpUaFVFmmdYZ4j7+512hmd2mPxWdkRVRUNDQ0NlqIpUVJqF621DQ0N+dmhmilZ2Q0NDQ0ND2VhHiXnHRUNDQ0NDWdy6V1dXi6qaaVd6nWdlZnd2dpeXqoiZiWhoiHh6eWhVVWV3h4hmVWap7fv37Mz/iIf/WldXeWdm74dUVpd4dmZ3vMuqz2hUV1lqWGdYU1NVqJh5VWZEZlWdlZ1TU1NTU5vceFNTU1NTU1Sth3eHhv9pU1NTU1NTU2e+V1NT3PzbuOrLaZp5RVVVVVVVVFNTU1REi8vc+uqLmGWI34ZFZVZoqrqqVlhWVFOLWZz9ibyrd2VXnEVFRquGzsq6i6xWmWeI681VVYloZmRlV1RTqkZ2/KxUVP39m1O6rYlXU1NVU1NTVFNTRVV3VlNTU4v/U1OMVUVTaJu87bx8nWdnd5eXZ2h5m4t83Oy9VmdWendoVFRUVpz+eXfd9928fLvZ3btZeYqJVFRUVVZUVFSNe1fbnlRUVFR5jf/+t6hVVFRUVFRUVFRUR5lpVFRUVFRUVv3bmHdUVFRUVFRUVFRUVolUVFRUVFRUVLxa/FVUZmZmZmZmZmdom///aGdmZmZmZ////2hnZmZmZmZmZmZnnL1mZmZmZmZmZmaN/2dmZmZmZmZmZmZm72ZmZmZmZmZmZmZm/2ZmZmZmZmZmZmZm3mZmZmZmZmZmZmZm/2ZmZmZmZmZmZmZmvWZmZmZmZmZmZmZm/2ZmRVVVZWVlVVVUVVVVVWiJloaGhYaXekVEzYl2hYe9dWV4d2VmVVa3taaFdmWGhppXhpd1prWVlba5l3V2aK309PS4i2VVht1mdt7H98iluayIZmaeVofdxuWKd1aNaGh7Xm6quse2nz8dHG+cXxcVFBQUP9avFBQUt8jHx8e3l8fIrKemtaWmp5eo18a3lpeXNVyomai5mNeMprpJN22rnJbJxpeIuLlbjzQ1n42myFtHqW42MzNGNFm3mJq4l0tuXjWPM7k0NDWOjkkzMzOXmcaZl5g2MzMzMzVuM63INTQzM0ozMzPKqMe4vDQzMzMz3b6teVZWRlhqq4x8fFdXVlZmfb7fr77djFhWRlVWVqW1xdX19fW8rXqfbGyuWXlVRHZoXGZ2RFilqbra9MxEREVGaMnNzJqXREVVaHV3RESWmZ5r2UREREREROb05aZGRERXV2ZnRESai5h4SEREREREREf01odEeKq5x9fXyMnJyNfX59ncnmlpjJyLWHt6d4nI1rmXhqt2qLeJubzNz7ybiotZibiZRESNqrm5ysiHl7xFRERERESPvmx8REREREREREvnl8fLRERERERERERvr2tuREREREREREREuc1EREREREREREREvKlEREREiJmZiol3mZmomIiGh4iZmqmpqamqmamppZWVlZWVpaWlpaW1tLW0tLW1trW1paWlhWp5aYWFlZWJiImltaeoqLW1tbanpZeFTop5VnVpaYVlmqWHf18/f7e1tZmITwsbBAQEBV97WHd+CgUEBAQEbm8FBQS5egQEyrqqqaqZh7jKmWZprsrJ2OfZ2o6u+OnZa1N1mXSYeYiVd2WvdoZuq7nYupe9hsyoVlVmVERWZmZ1VFmnyqjbq7vnxpd1m3VWVkRlR0hnVVZYZ1NlZYyY2+WXeZuGY2RUIyEhIiE3I1w4NSIiNyd/Sn+fTUg2IiIj+fz82JeHeYpoRVh7vP/tt8jc363O6tn7d3h5qol2z6lXZ0S8iJyKdofruqdYZnbumGiLvJtWRr2LZmloeZxFRXi7mKq+eJpVRUNDREZGRXdWd4dFQ0NDQ0NDaJqoVGdFQ0NDQ0NDQ0Vmu0RDQ0NDQ0NDQ0OrZkRDeHZ4aouaiod1c5SUprfX5+fXx7epl5iJRZt2eXxDRTNrRzdGhYno2LanyGdkZlk0esd0qZh0umc0alVJZ4y89quOzex7Q1dWnJeoSGrNtpXJf5iKj5mZ2YdJqOdlM2iKISEhISFOjzkhISEkTYu4qjghIquqWZwiqpm77XhoZmZWVVVURFRUVFVUVFNTV3Z17XuaVlf9qWZViVj6zIm6iVWaV1VUadvbef1XdmdnyWaHiv5Gecvvfv2KaJtV3v+YWGZFZmdXylNTqZ2o3lZTU5n9WFNm/4irU1VTVFRUU1NTVLqHVFNTU2n+U1NXrFVTmp2Pj66qp5aXqLemt7a3x8m5uKmomJeXRUVFRUVFRp2nx9bW1tbW1tbW1siomH1GSElGRUVFRX+o1tjV1dq/S21vr3xYR0VFSEd8RkVFRUWn2tbWX0VFRUVFRW9rRUV/RUVGfkVFRUV9uNZHRUVFRUVFRUVFRVpFRERTQzRFREREi8yriKubaXyqppemmUZFVEWGd2VFh6f52oz6i9zr7XuKidydy35UmYftZERYWP+3VZlUeKrZeWeLi+96ZahKZ3ZjZe13U1nLVHhTrp28prb5WJpnaERVQkNEVHhCZEJkZmZlRZtBQVpGaaupREFGuK2MVlhqeIuvenRjVENDQ0RUVneazMrId5b66/p3R2m1mcppd2dXZzNDVWX/nWZtWVaGmPt6vlfYiJxVr/9rV7tlSVKqmGRWU4sypopVaVNSZjJXmb1X19dpif+qvGYyRGRWykJDV1ZmQUVoVKdnh5VpqJhVemdYtaSjo6Okx8fWx6eWlLfIt6SjpJOTpLW09vjn2/t5RzVLf61ZituWlKWWg4OFg6bGrGxoaotGZjZKfFlFXovZl/z4qHNkZYiGSjQ1NFlaN1dFV1hUnWeffY17zN95fUpUXDY2NTU0NTc4NVdJf28zNm04m25mR0Y09/jpyJxsVVRUVFVWepmZqaqai8zp+PX2raro6atVVFRUVFarq79tVVVZrPfXmahoV2mL+FiMVFRUetltWVRUVFRUnvXJilVUa45U7VRUVFRUnVR9VFRUVFRUfeqZVVSvVFRVaXtUVGhVj1RUVFRUVFRUVM5qVFRUd1ZXdHWGZmZniImJiWdWbN/Ky9vayLeou3Z5VVSYuYiWmYme6vzomM3Zz7yqqJZ1SFiYRGuIVVZmZmm3+fn9eIyHaph6VXl3WHdFdYhGdkRGRERZVoprb3z978jOZ0c2QkJCRFVERUNCQkJCQkJCRG+LQ2tEQ0JCild2laamhmdni828homaiml6i4eGhXeIiKm7jHhnepp2rb35yN73+cqpzWacZpd5x4x7XJyLmYZquq/37Oe7yfioy2hmeHeKMzMzMzMzXJZ36r66WzMzMzR7m5l3h3Y2MzMzMzMzMzV4rjMzMzMzMzMzM2ZUVjMzr7i4tra3x8bHx8fHx7e3vI9vRkZFRUlfR8ypt8fIx7e2x8bWx8fHv0ZFRUVFRUVFRayMqqmoqKanqKe3xtbGvUVFRUVFRUVFRX1urnuImkhFRUVFb8fVuEVFRUVFRUVFRUVsao5tRUVFRUVFRUWu1kVFRUVFRUVFVnmZeIp5aWh4qcy8q4qJaJrK2fv7mnl5VlZXaId524mbipuq+c3q6M6au1ZVVopGd2hXaInvZ3mpu2jK+unue9/5m0ZHmphnVldnelZ4Q0NnVazYnGtCQkJD/kRCQkNYQ0RFQ0NCQkJCQ3tXqkJCQkJCQkJCQkJCx7fIu6urmsjIxqWmhoaXlpqJmIeHh6enq3eXdnV1hJh0doint+jZiHms56xWaYd3SkZKrZunxbSVlIS55qzNbFo3j59+W2s3izhHNDOuydXGtseJiV4zMzMzXc6fjTQ0MzQzMzMzNbmnmqk5MzMzMzMzM2x5SjMzqbqpqNn573xXV56v/P/8+v3PbFmP+unqVEREVFRmme+cyJh2ZWdldZqI613JdlVUVVRVZlVVRHiIVkREVWWWzPmaZbtlRENDZWmfjHaLZkVEQ0NVVVWGv/vMZFVEQ1VUWVRTU1NVaFdmRlZpeVlVVFZ8d1VXVniHevv53ndlZWZ57fz7+6uaemdmZWdoVmV2z1ZWZ0RV37+aV1Z3Rnl5VkZn/Pz7rJ39d2ppeZh5aP9VaEZX2phmVd+6VZxEZ3hWVHdUU2h7eUdVZ71mZ+tUVo6qmaponFVTU1NTU1NTU5dVU1NTU1NTU1NTm2ZTU1NTlqammHmIl7fJfXyajLm3tbaltZaWhoeWZyV+hndXhlxWZpamlpiOxcXGfLemlZV1IyO4tpiXvCMneJt8vMZ8yNeq1tWIZ4ZmIyOneMZNIyMja2xbm8uOnjkkjtbGtZgnIyOYmawjIyMjJFp8h69+IyMjI36dq58jZmZ2hpamppaVpaWmucrax6amhpWVlqeYqJe6WVZmZVVVirnm9fXYiIzbvFdYm5m5mpxWdYV1dGVkh7esqq9vNDSO2Z1Lfky/NZ95uOe2lnV1pmavNjQ0NDTNlkY3jjQ0NDQ0NZ/beKqdOjQ0NDQ0NDQ0yH2KNDQ0d2hnd5eHdmdoeGZn3/766//vr3Z2l6iYd5iZmYa7qWl4ms2d+tenuKa72Nd4h5WHRkRFaclFRIlXie1rRZr5jJ+drZfOdnd6RERERERERERomoxERERERERERK34ZUZERERERERERER530RERERERERERETriEREnKqmpKWmqZq4qKm4xcXExampt6icX3x8ZmZFaHaHlaWmtLfU1uTJ1ptti3ZnWVpIb3tnZlZGdYWltajFyObobtmdfVlISFdvMzMzN5hlR1Z3iKiorU44j1mN12U23V8zMzMzMzM6eGZlfDozMzMzM9o0Nzgz5zQz1sbGxsXHqry6ybnJu7q7r7+8yNbX19bWuainmJqbubm4ipifRUVFRUVFRY/W1sfGvH9/f5qJiKh7jo1GRUVFRUVFRUXWx8emRUVFRUVGmmecamhFRUVFRUVFRUXHqqxFRUVFRUVFRWmaa0VFRUVFRUVFRUXIfUVFqr+vr+/vq4d3h4aWl6fI6dnYt7eouLeoNEVXNUSuiHV2ZZeWlqbo+vimlZV4fG43RnZXRESebEVHq5atfbrH9/y5bIt1Vow0WGZYQ0NDQ0NDREiGdleb/duHeGiHh5c1Q0maQ0NDQ0NDRHd1iYx/SUlERENDQ0NGZ3hnVlZoeWhWVmd4Z2dmVVRUVFRUZWVmhZWGhpVoVml4hYWFhmhXl3ZnbGd3eEd4dYZ2pYWFeIWFlYaGhnZWV0n7+exYW1Zlv2WWd3dXllZoh6Zl35v/n/v59v2br/tpMzR2VXkzeTNpVWlFMzOtv1v4r/drb4ozeGpqa7zb9fn7r62snd/eiou8imVmiWhpVWWFhWk6vW7NibjHlVZERURGelRERERGzKxHe2o1mmqenFi5m2dWZmaGhYdUVUVE9ZZVVtyLnVjsilW29FhCQ3eHdYZGQ0O8h0NCqLlERER7rVVFtvT2REJDVkNCQ+u4zu7frbza9fPz9ujnycrJuJh4VkdHWGt8mWVVVZvcVZlmV4vOZnh7aHpViFVnWGp4nFh7jERVaVhXfpmLVWlXeWfzyVN5aIpUVnhnaVRmzFarV5tlVLpmQmz151VkQ89XQkJnNlVUuVVVZlVXRGmvQkJC31ZCQkJE2NnYyItpVVZYu8rL24x7VVVVVVVVVoytyNrXqVZVVVVVisfoyMl8VVVVVVVVVX7YuubX6GtVVVVX2NfXytjPVVVVVVVVVa/Zyp17VVVVVVVVVYysueevVVVVVVVVVc/nfFVVVVVVVVVVVVVVnp9sVVVVVVVVVY+vpqq6zVsmEyhcudrLqLzMvzwVExMpnry7VUVXZleGPXh4ZkdWeHaXyfTpFL6nmWVmdHRlVHlsKI2md5WkxMfVvZ93mXZHrod3KERVVkREM1RHdImKqNfG8vKzn6SmhVZ1d0hvOktqZ2VVZnZ2dLbMv6a2pIVWhWV21tbW1sq7nX1sW2t6mKmouNbV1dfHxsbVeXa2ummGZoiqSb9DQ0ZblrnX19abh3aaqInJ1ce7Squ7qEptQ0NEWZi6yalud4eGXHfJzW5DQ35+iKtsQ0NDQ0dpakVEari8RX5DbkNDQ0NDRENIQ0NDQ0NYSENDR0NDiJycqNa3dklZepi3xcXUuJiKjMrJt3h4ZWeYuUuZeruNiYmWuliHmmp4tpRZbWpWjJvTh21Wt8bEwqxJqYqqaYqVimiGqYo1ZZdppuBsVIKlRYTY1E6FVbXIj0R6ybU2NUilRpsVAAAAAWu/Vk82KCxnSANHZyYjZXV2dneIprnI1amd38nY9vfrnYZ2ZGRkf5mVzIV9VkdXZWZnbNr32MenupxVRFRXaGi7vrxmZ1eoZVdUVuu89K2ImVVViIhHe5lYd0R/ZVVVVGmrhrbGqqzK6Z5lV4d2OlY7Mjh7NzIyMjJLa5g0MjMyb7hMMjIyVlZVVVVWWYqJaHl5qbe4uKiZiYh4aHpql1lVVVVVVVVVVm3+3Nu4uPn6qJrvz7+I7YdVVVVVVVVVVVVVVVVVVXvY+8hoi+nHvfqaVVVVVVVVVVVVVVVVVYn+u6+9VlVXVVfOVVVVVVVVVVVVVVVVWPl7VlZVVVVVZmZmZmZmZmhprf/fZ2ZmZmZmZ9//rWlnZmZmZmZmZmZmzoxmZmZmZmZmZmaM3mZmZmZmZmZmZmZmzmZmZmZmZmZmZmZm/2ZmZmZmZmZmZmZmvWZmZmZmZmZmZmZm/2ZmZmZmZmZmZmZmrGZmZmZmZmZmZmZm/2ZmmXh3h5aWmJmKjJq4xca2xbW2t6ionZuabJeIeFZKd4ebqLbFxLa3iYq3t7a3pZiMZ1ZoiGxoaXW5qrefxp2sxcXInqi1mHhoWSciIzZIaFqLxU+3rF8jIiVvrcW1h3pXIiIiIiIiJGpotbhPIiIiIiIiI8meilcjeIaVlmV4uKaVlaalh2l4hkZFZ2iIqFlpauz39q/Lmae1p3V2n3yGaXhsq/g6I/+X2G9ZeFrr2rnXiFh3aWV7VHZ5aYz4qZh8V1QhVWecpr2eOcl2iY98m2x8doe6l7jHISEhZ0h3iSEhISEhSEohISEhIZh7d1RF7ptoVlZnZ2ZmZmZ3Z2mKvIpoV77vm1iMVVRUVFRmVlbuVu5Gd4jOvv6Kec5X3karVFRUVFRmVlWZmmiuVFRUVFRV3bl4/GllmlRUVFRUVGiZmrt4VFRUVFRU/d35+frZVFRUVFRUVFStqYlUVFRUVFRUVJqc+d5naXtqRlZYW8nFxLiqW4qLbHqYpaSktamphsfHx4d3fHdHakZoWJuLnpydXZvmyUlWabbWx8ebrjYyMzWJtpXmtcfXuolK2m1lalrHx3uMMzKKnntqhcbE9MbWtUoyMm2GMnqdrUcyMjIyMnx9dqxtNDIzMjIyMjIyuaintqWllaeomIeIq6uqt6iqq6u9vtjYxta6uKe4uKubbYmIppeZqcfWxpqKqJq3moq7nYmZfzMznm01iainp6eqmjU0MztfM5nItrd+NDMzMzMzrYqpjrd+NDMzMzMzMzOIiIszMzMzMzMzM22OZcc3MzMzMzMziJaWl4aWlpaXqJeWpaWllaWllZaXlpeIhnd6dnp4doiXmKaYpbe3tbS1taSlpqeHfoeIhlhKOmiZepmnp6e3mKiltLOkpZh3iHZ5l1oDBAdol5empqaPrbe1tbSlp5mnLQUELXsDAwMZaKuPLxgZAwMZTz6ObG8vrZ2ruZmKmsrItqampqi4p4aFhZi4x8bHmJlmd6jH1sbJxqjIxrjIyre51qmot8nImmpuTGh9n6yox8fIvzR/XI5uzIWpiYaHS1x9MzM0M0mrm200NDMzSDNHM116WkRnMzMzMzMzMzMzvTMzMzMzMzMzMzNoVlc01dXm5ePj6q+fuqipd6eXt5aVptbUqKW2dZfJ5pnIqVOGU0GeZWd1Z6fWV4V5ZFVneZ9XQlKPlnWpnnwkRZ+fOtycmGbERoc4R0qqS3lDm5t4R1naSGlYN6k352uXNX1JIVeqh0c4Wjk3RFdtmTYgIEk1I7kjZ7k4VlVVZnZ2d2ZlZnZ2l7nKuKaVlZWVlpiIu3ecRkVFVVVFWZr49fX6qLz6mmeK3Jjqq1tXVlZVVVVVZ6auzM9/RES87ax8SEa/REq9udmYdlVniGqvRURERETdt2Z7RkRERERERFzPh72PRUREREREREREyLhHREREeVpbWouru5iXyfbl5/Tmq4qZicrMfGVmpbq8iLiLV1tZSKnnrlRnaFms6Hefb2m4Vo02rLunW8aV5bdWd2ZnqlRmMjM1SKe2WzS/aGgzu2XJh2o5jLTG8pi3VzJ7MnU1SGlqMzUyNTKLMstYazONMjVqNTKLMjIym3poaJubZWiLvotnZVVmaFVn3e38+vj7Ra/6aFXMm5dlRERY/XZmVWaLVv39381FiUXNm2XfRIVWRK2XfHdm7vncZ5pWRWZ3U1Z7eWVGRXWGnXlUVneqdkesRnqIy2hTU1Nmd0ZVVFNTU1NTU1NTV8h4VWhTU1NTVkdXZ1hpera1pnSFpZSVlZWVpJWVhnZ2R0cmWFV2ZUhauoyYhaSsm6+W1LSlZUU0/ycjSDVWrEeteIaLR6bUxayfy6eoaHev/SQzOGd0bIWXmDcz6GpGt940/rrGt4XMjDMzMzjKON5LijMzf4+nqHg0ZItXVmon7Pj4v1hXVVVVVVZZrfj36qytWo18jd76WNr3n1VVVVVVVVVVnM1WVVVVVVVVe89rVVX4+lVVVVVVVVVX71idVVVVVVVVbZ1VVVVVtlZVVVVVVWfvVVWujFVVVVVVzYxVVVVVVbpVVVVVeMxVVVVWp1VVVVVV+MlVp6emlnV1dYaVmc/P/f37zazd/5mGdXaGdodnZXa3dnW8/bqFl3Xv7u/Pzrpmp2ZmdnbYj5Z1p3W2d3WmZ1h4dofOh1iIZXZmWWZ6RTU114Y4aJpYSFo0N1yunIdGZzQ0MzN1RjQzWpszt3c1MzMzMzNGh1ZHMzMzmIeYqJmYmKiouIl3dYeZyKqadnmbuqmYiHqti3mrb0g6X8zEuXinlpnFxMXGl5aZp6hnaZ9WdXVlVUWf1MTU1MTFbjtdb33Fubdsd7ckNDQ0NVg11ca8bTQ0NDQ0NL+4jzQ0JZY0NDQ0NFxWfZ+5tzQ0NDQ0NNW4fH2cjlo2MzZYaWdoaYqImKeou2xJMzZHucVv1eXHbGllV12dtsi2poy7x1uK1dTFmXl7l6fF1K01d7fXjXmo5MV2NGnWxId5njNYZneXlcgzh9Y0M7/JecmaNjnKhp24MzMzMzMzMzMzWOQzMzOef1hZMzNmWMdurI19e0dVVVVVWGlYelhWVVVVVVVVVVp82MupiJ5VVVWPeKy9ybnXblVVVVVVr8isvsrYvHxVVVVZq8nIy9jVV1VVVVVVb9XW1sevylVVVVVV18vG18fHbFVVVVVVj8fXvlpVVVVVVVVVRlZu2tXVVVVVVVVVVdbYlZWGlqSlxcTGl4WGaVVnebnGxLW1pYSDqZwqaIa1xKpJSSlpSUg5VlpoyNR9XJulp7XDqXXE05kzibtraYjTjUtauoeO1MSmEnyot1uotzcnxHu1Fm6KZ4kjf2dvaJlPEhJmj3lMmxOIuagSEhKsxxNbdVwTtpwSqbe1tbe6ipeourycmrjIyMi4iZyruKuLd3eGl8alpsbV1cebmY6rysrWp5+PfZuHm2mYS36Ml6isW2iMqJt8NDQ4bTQ0NI/Jtpk4NDQ0azY0NF+Zp5ipNDQ0NDQ0NJi3SzQ0NDQ0NDQ0NDQ0f8XGNDQ0NDQ0NMa4WFdWVXaGl4d3h5WVtKSklJSUhnl4ZlVWqcSKeYfUuGqJlrXFupiVmZfIxokUOY6sttS+XYfkOqWdj2t6mGu5t6fVeJrIuJlGTRMSE4W2NZjGfLm+jZuceZczqVqoeHq4EhISEhSfEk69bicSEn6pfzdVhhMSxNQrmJeXqLna+vj5+/v6/79/r5ubWYyLrZtsZ5qnlpampq16WFdXaK9lZWVlZ2hlZWWre2hmZ89ZZWVlZVaYpn1lZ2Z5ZWVlZWVXV2VlZWVlZWVlZVbM6d9nV2VlZWVlZWWfVWVlZWVlZWVlZWVVZ2llZWVlZWVlZWVr6Pb29vjsn0VGi8ra+Ny9VldnZVVa3/r4RkRpl5bZ+Ll7a1TN7HuoeZypZ3iIiGZmdVZmVXdpepqLq1yPn1ZohnZEU1N6nXVkaFV4VlRFd1VWdXyPq696uY9TU1NTa2ZWU1NTU1NTU1NTVlWn+UV4VWZTU1NTU1hWK4+qpqampqalpaampqampqamp29PFxYmb5aWlpaWpqampra1uH+2trampqammhkmZ2d3d4eWl6oup7a2Xxa2tra2pqaWlnx3KxkrX2d3lqampqeejammtrW2pqaWdmZrJSUlJSUqeZZ/JiUlJSUlLLe2ppeGTiUld3d3d4eGhpaWpra2x9fo6en62benlpeHaM9oaGZmdnaGlqa2xvj5/alpepmYiGZnWN9VVVZcnIh3doeJapurn3xVW1pVVVVV+bzvVVVVVVVVVVVVjI9VVVVVVVVVVVVVv1ivVVVVVVVVVVVVVm9VVVVVVVVVVVVVeGh5alpqWXp6mZeop5eGh3hoiXmKeVlpalpFVFRUVFRUVEa8p6i3q9qZhqiJa2s6W1etvFRUVFRUVFRm6enm99rlqruIaFiejJ+ouFRUVFRUVFRY7+j69vfnuK9WVFRuXJlUelRUVFRUVFRUrrmar11UVFRUVFRUZ5mbfDQzMzMzN2lpd2hXSFhYeGlaVmZmj4iGx70zMzNumJd1a2drl3u4yWt3l51lZYzJx9YzMzO/5ZdrZa+mlop9aXi7p8bqmHmpl6YzMzO/xuVqn+XVt4UzMzSm1vaWNTNMN24zMzO7OswzapTJ5r0zMzPb5rx1+vr8r2xqV0dIra9tVmdnVmd3hmdXasnZ6rbMbHZlVVVniGllhrecZVbL7/t3WJe5ZXyGl3asaaxVU6plaOr4x/2PWHirert1VXlVVEiKVlNTU7uGeK55U1R67lRTVK1ZVFNTU1NTU1NTU1S7VXxTU1NTU1NTU+h2bGZlZWRUZGRkZWRkZXZonerpv8+/z9qsu1dVVFRUZGWc9s1naGWsr4h1dHR0dHZsmUd5rFVUZGRkavfcz3j7h3ldeVlWZWRWWERERLtUZWVm+GXfdb2WRUTO9ulcRWZWWEdnVUepi336Z2VlVpxERERE+fdERERcZWZlZWZ2doeGlqamtra2p5eGd3Z2ZmdmRUVFVVVVZnaGlqbp+/v7uojPeFZseWhmj6lmZlZFVVVmdpbH2tqZz4yPf1tZVVVYVVVWj5p2VlZWZmZ2eZ9VVVVVVq9Yz1VVVVVVVVVdqnd5i55YVVVVVVVVVVX8+1VVhZeXqX1bRURENDQ3n8vX1NTU1renmqmnRVhbl5u6mpu8bTa818bV1NXVyrdtuXdWZlhXdog1RESamMW7utbJutjGl3lal6lVSENDWJlGRERorMtN25+PWENDQ0NDaHdEQ0NDREWPQ0O8Sr+vRle8VkNDQ0NGilVZZWZnR0VFRX6/+erc2/b35unNbHZ1ZWVlVEVGRVVVVr/P2qjaybray3l1dXVlZVVVVVVGRVRUVN7cq82ve4q9lYWIi3tnVlVEeVZWVFRUVPy631VGZnWFq5p6elh8aVlVVFd4WFRUVOz631RUVWhoVVRU21RUVFRXVFRUVFRWiod3VmZmeGdneHp5VVRUVFRUq/7/eldUd2Z2hrvOzZ/vyZdmVlRWmLn/dq+el/2pVEZmvdtUVFRnvKpWaVh+7KhmVFVXeZjoulR16FdUVFRUWPuHeIf7iolUVFRUVGl2vlRUmlRUVFRUVKyLikmcd1RU3KxaNTQ0RUZFNUiM7K2dmYiZlqenyJubrapYNEREVkRDVolX7t+lpqWlhHR0hYSFdXasNkRUZWhGeMpEN9/v+Pj556VkiIZoec1likVkdFl5zHVmRDS8m62Gtvl1bni6REaaioqqm0RDREVEV4dFQ0NDja7vRENDmrmoqby9nJiHaLu5dWVkVGV3ZmZmapydmMuq2rt5aaeadWVnh4n59+xWVcyHiru4p5eJQ1doRnqpiZmbi+zPrt/fmVdYuXj2aENDQ0NDQ2jor4xHqcdreUOLukVDQ6uHQ0NDQ0NDQ0NDQ0NDQ0boe0NDa0NDQ1hDRERFZoeHZmZWNDRFZqjIx7eXdWVVRTQ0KUg4OSo6WVhIRiU1Z9j08/TnhmZHalo5dWR0hIV0dIWVlputiJyPz5+6+daVtaV0OGR2uKZ0ZGp0ZHWll5nm9tXmfdaFh3RkZlg3SjhIZ4eajHx6aHyPz5+dmp2OmYdnZWVldoh5fIx9fbu5qKamp5WVpaWllod2ZVVVeUplZXWFlaWM7vv5/PfWxpaVloVlVldYWmZmeXyfz8jpz7vf39+nx5Z3moloRGRFOFhFRERERDi2qqbJnlxJa2p9ilZVdlhVRUREREREREacRkRERERERERERERJmpyMjIuampmZmamop7a1tbW2qai4mrm2p5p5iYiaeru7u4untqiqubWntaiotIy4eV88Jl+MprW1tMR8mqa1miSpqbW1ird4IyMjIyN8lZh7p7UpIyNNJSMjtqenintfIyMjIyMjeHttin8jIyMjIyMjJreol0sjZ4V2eWuKmKqbuqqqzK2tjKzNrbq5d4loRUQzNFWWdGWmiarLu7y7+87q27mqiFUzZSIkNCRVqmeJhGdnNXbr/+/KvplIaJmaJCIiV1V3qcvNqSIiQ2dFipiJiVZpq5qpIiIiIkN1lbWYdiIiJKi62HQjhUZGV1VUV3+//Pz//49vVlVVVVVVVVVVVVVVVVVV//fpyMnJ2On2r1ZVVVVVVVVVVVVVVVVWyJlXVVVVVWzp9mZVarxWVVVVVVVVVVV+mFZVVVVVVVVr+GZW5+Z9VVVVVVVVVVXNfFVVVVVVVVVVaX3XbczWqGhVVVVVVVXPu+qqqam5682t/d3M286MVVVVVVVVVVVXze78zZ1XWHv+jLqI6b36V1VVVVVVVVVV7HiaVVVVVVVV+s2c+1hVZ6h6VVVVVVVVmphVVVVVVVVVVVXP3VeYWFVVVVVVVc1VqVVVVVVVVVVVVVVVj797VVVVVVVVVVV5dmVlZmVldXV1dYaGlZWVlZWWloaFhXV1VVZWRkZGVmVlZnWWlqa2yMe2lpWGdXVlNjY1NTU1RkVVVnWGqMj69fjGppaFZlVGNUZXaVZGRjVFRVZ2l7fZ/9vap4ZmaEU1enpsTm9vbG9/j3x6aZmtn6+vm52Mj42LeHZ2iIubmWibjIiHiKqqvauXeXeFhYd3RUZGd4iHqPj4u4dti4pZifr9qY9YRUZYtu9KRGWV1/f5SqdXZ3lV53tvubdomsdvNHdFeGSUzeqapkapSEJZmb1XeqiZVlZHQkJCa5eYQkI0iEJCQkJCQkWLY2hEQkJCiWh4V3amiDQ0REREVFRUREQ1mZd2aYl3imlph7qId71EVEREZERUNDTohs2aeYqrmYh4eqyqq5qXakRVRUQ0M/z+/5laaIhpQ4mJ3L3a283cnouIV0U0+v3/vquHp0RDQ0OHREVFurjJ76pDQ0NDVJrMqIhoQ0NDfbemmlhXrNq9r+bWzs2+vNfnyJaVenqLmGW6h3x9Z3y9yeVmdXkzMze2qIY3MzOub852Z5a7x8vlnMjLaTMzM0nn2Zg2MzM0WHVnhZa2pbWFu3mYiZisMzMzyDMzM814eTVIZzYzMzM3Z3dqm0g3MzMzMzMzMzSPVVVVZWVlVmdonM//z3qu//z8nWZlZWVlZWVVVmZmZ2eYl1eFrr/83614ZWVVVVVlZlVWZnhVVVVVVad3m/6Z9/h1Zqm7ao36ulVWdoZVVVVVVXdVdXV3hYa8jVW9VqxWvlZVVlZVVVVVVVVWVXtVVv1WzVVVVVVVl5eXl6i3taSkpKWltbanqKe2tLS0tbanWVdWaZuYmLWlpbW1taafXUxvp7e1mXpZnKglbXiJtpa1pqaqnKW1to5lj6upq6emrrgnJHiYlqamqD92a5iYtqdXh5+ZnneIbSkkJCQkJCQnPyQoqCwkJCQYJCgkJCQkupiZW3uHeFdWRG2f2pyLbLyqiYpoNFuPQzRHnFypuGuemZmarUaYttbk5EmIdmREiGWvaZXo8/O3q3w0RGWGdkl7iTJZWFRKV1ZWmtTk5eny6KllmnpIMzKsmGkyR7d0WTJbiIqlqKjW43s2a2wyMjIyqzIyMjV6N1pLe7iqSTMzOI2duLi2tpx+bam2mlpapqelpZaVnzRtqbiluKusutbVq7d9M3+o1ban1ca1uLtJt6ymrTk3SquVuNZbXoi3mlk0uselmckzbLe3MzMzMzNMd4ozn5bHNDOoMzQ0SIszM5k3MzMzMzMzODQzqpm4lrjH1cueR0REREVGfWx7emtrrJuse4iXzObn5tafRERERr7FqKeWe2usv2h6fFpcRESWlZVtREREr/XVyW13l5ZcXYhrm415RERERERFREREpsfZRIXbyJhERNjYluiJRERERERERERJmZRERHuayEVERK/IeOdF2tnYyNro+vjrz4aEhay/r8+/vHhnnL3ciplld4mo2NqrZXanlnmIhYj8+crXqauJRUZmZ8iJlnVlp4ZVh0hHV1drdo2srIhUNFdEVYial2VsqGaXMzMzMzSPi0hFNTMzMzNlV3ZIVzNXbDRJMzMzMzM2aGozMzMzVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVzIzt/91VVVe73P/PiopWiFVVVVVVeaxqes1mrPvsVdy5ZorPemqJ/rlVVVVV3XrLVVXrd5nuVXrKh7t7VVVVV1VVVVX9VmdVVVWI28xVVVX7zapVVVVVVf1WVVVpd1VVqa2PPEdHR19/ura1tra1tba2tra1tqampqamnUdWVlZWV4+1tbW1tbW1trW1pqaahoaWlmh2dnZmWZ+fmrm1tbW1tbWll5eWdXZdZnZuPyt/amZfpqemqaemtqaWhnZ2bXd4dxYVFRUVFXhLfxYVFRUVFRYXFRcsa1hZVlVVVVVVVVZWVlVVVVVVVVVVVVZWv3zN951VVVVr2fuu+vd/VVVVVVVVVs/5vLrLzdpVVVXrvLrorI78VVVVVVVVVfiI3X5WVZ5VVVXdVli/6Of4VVVVVVVVVd7HVVVVVVVVVVVVVVVVVVrPVVVVVVVVVZxWZWVmne+dWVVWV1ZlZWVlZWVlZWVlVmVliXhYV6u7VmXJyt//26r/e2VlZWV8/8tonZfHiJhlZWVXaJinZs+ti2VlZWVl/5t46bpXZVdlZWVoVmZ4yJeWnmVlZWVl/6aHZWVWZWVlZWVlZVVlZYqqaGVlZWVlnmiKWoydSXudaVp7jEtqilx+W4yci519bV1rZnV1doh6iIZ2dXSKdHV0hnd0eXRodXV0tbbExOVf1tS4xcXWxYSWh8W2dXZ8ppa1xyhlY4toBZZ12UU9xJjkOsv0tsQ6ycXFEyhFExMpEhITdakST20VRVTXiE+5h4ic5tbWyKmpmImJmZiHhoaIfIuKi6i3x9bW6te5x9XYx7aJanp5jH1nd4eWt8bWudfnRUVsRVrXr0VFaY16r69vSp+/itbV1rhFRUVFRUW7RUVrbUVFRUVFRUVFSozGRUVFRUVFRUVsRUW3RUVFRUVFRUVFRUatRUVFnWtZRERERERERUdJXb3LtsbG1eXm1sjJRFy/2Ojcb0RERGvG1ceIeq55qa1HR0REdpW11eTVtaVbRERvm3/HqbyPxbdqm0RIZYtbRUVKjIZlaHrG5Y62fMWmRm+2p1hUWUREREREREV2RauGSERERF1cRERHipl4ZnV3z1pHVmiIqKeXzIeIh6m7i3Z2h2d2Z3hlrUd2dnaGlmeMu8mIZ/+I73dlVVZVpndnaEWHd2WGRZ1WVlZW7//5z95Wh5eHZ3pVZ1V2VXVFV1R2mFZnZ5eviNyHVWZWVFRUVFRXVFRVVFRUVFRUVJv//3l3VFRUiWxbWVtcfGZkZHR0hJant7empoaGZVVlVUVFRla7ZniHdZe41/bz5OXGxcivrzg3RTM1RnrfR62tnmx4Zabkufmnllq4mJdvzzMye3aYdrafjzYyRTm4SGq9iEb55ZhGSDIyNDVLM8uqujIyqqq3mkc0RW1mhlVIq8XG6b2uSVpJWr776Of257ytempqjX19eVi4jkRneHhmVERGl2V1ZlaVmZimlXZXmXV731ZDQ0NDaFREhsinv3a+bd2lhWRsZVVWxkRDQ0NDWWVGfObV/3nnxnmKZ3mKeWZXlkRDQ0NDRLxJQ/bYx0RERUVHRElXNDQ1OFxtraunpaWmpqe3qKuOnVtbOCQklZWVpaVrtaWFibjV1teamsmfxau1paWUdnVrhnmJfJu2xsbKNCS6yrvUxX+lbYdXNjY3Nlx6hIu1xX6sxba51bvUyH6VezdGNDQ0NDQ0a3VvjzY0NDQ0NF+uVzs2NDQ0dYaHqJeGZ2Zoamh3h6Wm6Pn6+7qZZlRVmmo4NkZHRWVld3mHZmat7//fbHxtn725ZmfF+rZYRER4eJysR1Z1pef5l4Z1ZGVXRUWm/5VlV1dnaGx7iJiPdob4ipR1WJtnQ0NEZVZEQ0OXd2dDREZGQ0RomDVZRFdFlqmcW42Pjzc1NDQ1jvr416alloeIineGdnWHWnZ1lbhbRDQ075+tu+jXxpZ1ia91aXpoV3t1dbhUVUTcvHl6ndj09reFZ3l4RESZlciolehERTRsjpuX+b6Zl4asSURERERYSUZEa+pER0dEREREREh/dXdEREREdoiZmYeHdpiYt7bGyLe2p7i5x7m6rJuJbo1oe2tHRkRGSX/GxtfW1cfHyLmKbW1sbkpsWkdERERERHZX1dXk1sbHfktKREVbn1t3mchEREREREZ228W3S0RERER/xl7XRESZRq9ERERERER7jEZERERERESt1da3h4aGd8v87KeomLrK+/no2NnIx7amlpaXWHhWV0lo2Wp32bqX2siWh5Z5Xf+/j1pXRERERGhHZ3qJrJtqu2pEREZnqu+7r2dFRERERERoV3mJV2nbREREREREi9mnZmpERERERERERImXhoZEREREREREireWZkVEWFl7rp9+fTU0NJ/fzZ59nLm5qneHmN3fVVZWRd9YZ6loinba6cr3unSFhJl3WFdVi0RXZnn3e/x5eZh6SfrplaaHZ2hmq1ZWZmlDiEOWeZuae0d8aWhliERDQ0NE9oVEQ0NDQ0NGQ0WoWPZDRIt49UNDQ0ND9kREREVIepqKjHmHl8na24xqm529+OjorFdHRY26iqybVmja2b18RprYnMq7ycrZ1npGdod2dnzeamevms+sSFf46+jWxbWlhYZmVkZDRHnPQ0NE+1h6VXh5R0RDQ0NDRJtWQ0NDQ0NDQ0NGQ0NDQ3tuQ0NDQ0NDRGVpjod2dYaHqNnZ6bqqam6f//39+/j3+u+/uoe7iYnJdoaamqx4ioaomXlERERFaZlod2doaImLelhWRFirycyIRVVkZHSEZkRXRWZXRkREREREREW4uPuKWFZERERErXd6eEVERERERERERETPar9qRERERERERGpnVFRUVUZWWFVVVFRUVFRUVFRUVFRUVFRUVI/7q4d1ZnbL+mxUVFRUWXqZiopHVFRU3vj3t4Z1dnaX2PduVGymloaGhrf22HxUh6e5r1pHWIm5+PncbGZ2jM/f7uvKl3bPnFpUVFRUVFRUVZ+Jncp+VFRUVFRUa6mrZVVYbLq3tntKfV5u2sq9e4qrpZWVe0dGWEp2VlZGjJybXm3b3HpmVXra8+dlVllFRTSM1eSfadS6fZlXWmbJ5JvK11nG5mRFhLarR3R8M4TIZ9SqljWI1LqtqamsjEd1x0tnMjIyMjI0V+bLaTIyMjIyMjNrNDI1pbW1tKaml5eXp6mZmKintLWmpqepiKinp6iHiImXp7amp5e1tLamp7S0taaombameGd3eYdoeaWXmZaoprWnp7eol42ZqJd2XxYZFBZfd5adjy2Nn6e1iqaonbapZ3ddFBQUFBQVjCoUFBQUFBUUXy5fFis/FBQUnLzayKuLaHaGZoaGdnZmWFdFRVZ3ZmVnffi9jeuet/ednJ2c57menbz7RK3GxriYmbi7m8rK2rmKvsu6zFdERWz2tkdZiUNZaXhHQ0NDRENDQ3m7fEaFp0dDRUNDqZV6iENDQ0NDQ0NDQ0NEmM+dQ0NDQ0NDQ43K68+PZmVlZWVlZWVmfv/8+/n6+vj4+vn5ucluZWVlZWVlZWVnr9+NZmVlZWVljpzPZ6m+ZWVlZWVlZWZ4j2Vln2VlZWVma2VlZWWaa2VlZWVleatnZWVlZmVlZWVmZWVlZWVli2VlZWWNZmVlZWVlaGVlZWVmbGVle2tJRjYnWYd3VWV32vr4+qeGaUpalpaHVVZ0ZGRXOmh+R0ZVd7qP+v2cmKm0lYRmVGRkZlNTVmN0ZHNzlKXExJzVpNelaJZ0ZlVjr3t+KVVFVWVmZnl6jbrZtpg8n350JCY5J0hZZFRUZFR7hp+en9r13qSIzZo1VVVVV2trnmtrV1VVVVVVVVVVVVVVVVVVVVjq6cnZ2dnZ+OtXVVVVnLm5ubnInFZVVenJWFVVVVVVatjrVVa4+K5WVVae+MhWz8tpVlVVVVVVVVXbn7nPVVVVVVVVVb/M2lVVVVVVVVVVVVhW+N59VVVVVVVVVd+vn11cVmdndndniJmIhYaGhZe4x8i4l3V1XmmMfYmmt6l6qdn96bbYyLesZ1V3h1Z/Vjenqcq/3djG+X+Hr8+4/JaIp81mVVZqZoZtRERERER99/iXj0REREREREhtRESKeEdERERERERERtZ4REREREREREREREREbV5/np+PnktKNCQ5veXm1sa2pYaFdZeaZWZlVHdoXJnGzTq82ui6y/XNybeGh3hnWlVVZlR4XFybrsdpm3as+K/09NWWZYp5Q0N9dmuLlqREi2iabJeJiInXt5Z1eIs2Q0M0NERDROc2dkNDQ0NDQ0NKhVpEQ0NDeWp7jGlXVVNTVWhoeXl6enppV1ZmZ1ZWre3ezotnVZ1XZrz09f7//ffaeHdXaHmG+73cvYiV685ndsxpjVhoe2hkrGZWeoz1VVVTaHeHdaxVd7Z7U1NTU1OOaolTZMh4U1NmU1NTU1ZTV/5TU1NTU1NTaVNTVIVnV3qayIpqiba3j2lnZ3d4i6enh2d3d1ZVTD+JpcWaqdLE1KmLa3eHxaesuZd0Wjtt0samaLW3tqnGjMWGlbWmeLen0ppqfavTjnhbVqa2ppmopmaYtj9amYm7uEzTl2gVEU4YFHaYEqlLdxFPEhERESlsZGhOERERyPq9WrzbmZu62r2cbI+tm4eIeaus/dupyJmIlvio6W5ENDR/nKmMSTRER61GZ8mWiliHd7f3j1VFRV7Je6icVTVdpnh3WERpQ0NohnbWVVV1VbhFQ0NDRTb2p4hDQ0NDQ0OOpqn7Q0NEx7lDQ0NDQ0N8pkNDQ0NDi2loZWVlZmVlZWVlZWVlZWVlZWVlZWZn+Pj3/492dnZ3eGhlZWVlZWVlZWVo3/v3+Pr86u9mZWVnZmhlZWVlZWVlZWV8+vr4a2Zpaa9ojYmramZlZWVlZWVlZWV6qs6fZWVmaJhqiYqq7Z9lZWVlZWVlZWVomWplh4SEhYaouzY0Rmdofe36yez/uqamlYiHhpaGmv+FvDW5u0U1NWy2pcxGQ0NEm3iFZ0Xfq4d0y2ZZd9iMSN76q0dDQ0NDQ7+HRWloekVERndnOOt7OO2fRURUZHZFQ32qRENDQ0NDQ0PbeqqcmbZEV3hGRniHVIx3xbWmlZWVpbXH7Il4V4mKz89/W7jG1ebWRVVWis+WuMpEZFQ0NDQ0VER85/tc6bdXmXhVNkaHllpURYqVxaj4mzREd4irzM1bWa9DRGdqtTQlu1c1RVebino0fkR5u7enZkNDQzVFmkNDhkND7nuoe69Xdp1EaGhpqWdmZmdniWZnh3h6qrvJ2bqsnZuqyLioZFNDRDaZqsibSVljVHRkRGzJyao0Q2N0QzaJmLererz4z/hDVFU0qkY2uDNIyjZEinp3iHm3eNd5qKvLu8xaMTH/x5oxMUjPezU3ZaWYicvXh2laqXv8MTExnzExMb5Ghnd3d3aGlpeXiJeoyNm5qKenhoV3Z3d3Z3e8vv/f/5v/d4Z1ZVaGmKWFd3h2dmiGaGuOm9uvn//6n2tXVmhWmKd6eIZ5dlVYRESJiUREREStekRFRGeYyHhERGl4VkVpSURERERERERERET4eWlIRERERERGZ3f8ZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZ2efz//Pv35oiXxlZWVlZWVlZWVlZWi/jY5mZWXPl3t7/miIZmVlZWVlZWVmbI7Mh2llZWVmuvz7emZlaGZlZWVlZll7is/5qmVlZWVlrPt6taammaintbW1nYuatrW1tbW1tbW1tbWlh4iYt7Zti7a9jLbFqbW1tbW1tbW1taaXOTQ0NVy3N6iPuLioxn+oj4+dm31vnHxrNDQ0NDRcNYlftZituDo0NDQ0O7W1WIl8NTQ0NDQ0NExcTLY1OjQ0NDQ0NE+1R0g1VWRkZGNkZay9qce4nMrY9/no2OusSEZWurpHRGWJyHuqy2VkZ5/frPf2+M24i4qrzEZDRlSqrKt9dkVZy3h512+4ipqJd1V4RUR2V1StWEm+ZkRVrndmdGXLbEVUZVVnQ0NneENEQ0PORZpFQ0NDQ0NGd3tDRURGRUREZWZ1mMyrR3uauHppV5ytaFVUREVFVERXVIm73Ga6+nhrqWia6dtnmlVERERW2uy9Zb/fe3T5VapWVkRGq9nrzf51paf+3FVEZ2i9VZp4q1Zoy+pnfZhIVXVaV0RpV1NTRIfsU8xnnVNTzFNTU0RDjERTU1NT9vrdf7+/+7+vaWVldmVlZWVlVVhZbc/+R9vn59rtv53Z2N6IdnaXlnVlVVVFRUVFaGmcqdftfL3n9vnpaWZVdqiXdWZnRUVWVVeYRmloZmZ1l39VVVRVVWVlZWZVZmhVVFRXVVVUVFVWjHZVVVRUVlhVVVVWVlVUeJp5h7nK6r+vmomJiszM+/bmyauObIyZVlZ6eDczMzSJiniu6/f6zr9XWKrGuWdUQ6mHVXa8QzPfNUyJeGequXdoQ6rmVmVDaKhlRFi5Q0NDyENlWkZk7KxEQ0bYe1RUZ0ZDQ0NDQ0NGQ0N3qImMqppDQ0OLhYh2ZnZ3t8a26O2cNUVFRTY3jPvZt4h3h4d2Vnd2dseV60VlRTXe/9v+rTW6eJ+/fkZmZ2ZWVseVe2VFnKeHdnZWr6z8/6iHp5g2REdmaLaGREVFhVZ3RERFZ86bqZh2eURFRESIiZ/dRET7iJdERERERESveIhERERESlZmdWV1ufrsWUVFREZGaaqM//79y6mK+zhFVGaEyXtEVEWt3c1XNTacmYZ3lYXfWnWFRmWF91REjallSJyWeLvK271VlnWcRWZlllV2+WRUq0Z2j4h1WIo0j4fJRXaIQ0OYv2jp+kN8d5dDQ0NDQ2dEVGpWRENDfN+/VlRUVFRUVFRUVFVXeGqLmaqJeWlZepvWzlRUVFRUVFRUVYycqbv67Pq5e/y5eXlXhYlUVFRUd1d1v1a5u4ib+53YerlnVFRp+XxUVFSIhqi8mWh4ma9V+8x3VNtnVFRUV6mMVFRWiFRUVFR5VFRUVNtnaFRU7btpZZnL/en6/J/N3llmZXV0lZaGdGdrNcq3h7paWq13Z2fvut5GRmWFV2jHunVGMpeGiDMzMzOrZGzLedqvhXVopnQ1hoQ1M0WId8mJjHmH/3t4mld2hUfZRnVnMldlnGdYaaqX6Xwzr69nRjR1RVc0dTIzMjIyZWZmRFREREVFVVRkZFVXrLuau3h2dGRkhUVDVIv/v/39/9vovGV1yplnia1WiZl0dFRGm9m7/HWGZkNDQ3XNqkRUREZ5ZUaGdEbsV4WsnUPfrM1tWVZsRlZnZnSJnEZ6uFqZmVRDQ0NH/WeLp0dFWoqamGVpy0NDVWRlZmRkZGRkY2R0dXmbm2Z1dHV0ZVZl7Fd2vP38u4x1dZh1dHSFdXv7val0rvubiYeGpmnNmunqy3qFZmiKmoWlqoV0ZGvNS0Y1NUzJn2xqbvVKbnd6Z4uZp6eGm3mmMzMzMzPtNDMzM3s22zMzMzT4bDZp+WlZqrqqyLXFtcbGxdXV1dbm5eXl5tbW17m5dmVlZmaoqJ+9x8bav52rmZ2v2a55dnaGd2lVVVdWVWV1hnt3hpefSzU1NX43OIuHTGdVWUhMVld4l5dnjzU0NI92XK9tdzU0NDRZNzQ0NDQ0NYc1NDQ0NLk1NDQ0fak0VVdYaZu73H5ZZ3d5WENDRG2fvebXrGtaNkVEVWXKjmV4SFnLydmaWkNu5qvnmEZXdujla3XJSEMzy41mVVzo6JxDn/brl3ZmR7dXVHXIZWRGjUjWemiZ2ddGVubLl0VCQUdCh8nJQUGNeUFYRUFCRH/Il7d7WEJBdoeXprWml6eXlpampsbF1cXGppaWhoaGV1aGt8aHd0VWVWaGuNXU1NTUtoZVVUZFNWem1dSnVjU1NVbHlpa21dW3p5pFRTUlblhqf39+aDUlNYqHZ6rK19XHdptLT25pGAcaHF57Rjg2R0dHWWuNj5fVb1eIb10amaybinl6akhHWGiJzYybxsW1p6WllYaI/3k1RXhWRGVUNUhIj63nrLjIiJd3eHV8WEV8m3Z3aFZHZUVKvH2rt+foppZlZVfPSFR1d/dYU1NTU0eWa/9rx/j1xcd1VlmNU0ZVZ6lFU1NTU7tEVEZFVFustWhEU1NTqsfGxcfKXklGSKzZ2Z5sSr/LtbfJzLqrqGmKqbfKRUREjNfHqcxubK3XnUVFRlbbRkZFRVaaR1W8RkZFfdqP2W28vsu3t8h5RERERERGnHtERERERERERdXl5da2VUREREREREREjX5ERERERERERESf1cZXREREVkZYi6ubynt7RlNTR4yLV3ZmZnh5eVZWSGiYuNj4yaXI9Y5TU0SYRlZ4ilmbydzPt6abRUVI3fiX975TU1NTqrj4+ftWysy5RldHWIl4U217r2xTU1NTyflWWNuJU1eZU1NTU1NTU1iejYxTU1NTU3ytmKtTU1NTVVVVZmdnV0dt3vj35ubm6Y9cZ2VlZWVlVVZWVVRUVG3qv8u5ubqs6uevdmVlVVVVVlZUVFRUVJ/Jqd327fn2eoiKiXloVVVFaVRUVFRUVK/N7J9Ud2WGms2reXlnaEVnVFRUVFRUVK/M7FRUVFZlVldVqlVXVlZVVVeM7+zue3mqrf//vb3ezLysmmlWVVVVVVVVV+mHmYjr3rxoVVVVm93/i2qsaFVVVVVVVVb8mqjMylVVVVVV31VVVVVnvVVVVVVVVVVV6/tVVVVVVVVVzVVVVVVVvVVVVVVVVVVVVlVVVVVVVVVV21VVVVVVvFVVe6m5W1dYiGtai+jX2Pn8bEpIaEZWV3p7V1lZm/mXx7rZyIdLh5pWicnH2LRkNEVWVUJqv9mMxdUpmZhCRTVFd9Z6a9Z1RmhG+q9EZqhZNTWayUJEz6+IiMeahnnohldXQ2iZmGimQkS3QzWLQkJCQkavRFhnU0JCxcXFxcXGrFxrWVVVZWh7ycXFxcXFxcXFtaWltbW1xcW6V1VlZXZ2eKqaiml8nLW1lYWFhZVfaGZHjLm6esjFmKibmpuPrW19aoWXljskJCQleLu1xcVpjsiObW68lmh6byQkJCQkJCQkJG9tm45fJCQkJCQkJCQlanl4SEVFVVZWVUZHaGx9vPvo56iVh3Z2hnVXRGWEh5SlxLhnatf6v/rYrsyblpR5ZWdYRGR1hae1tea5eufr2/yryGneeIVneGdVVFN4Q0MzSLeamL+/v1xERIpESFdWNmprNHdIaFdXf1xInH9DQkJCQuk4QkJCNDMzNklHSzMzNEt9qMnZ6ubHtqWmip58ZHWJdoh2lao3Nrzc5+nMvHu86MWIiJpkn49YV45JlbpDV6ivWKi82NqVrKaGeHpoZ1W35+dolXtDmJ1XQ0NaWYqbZHZlZlp2Q1hlQ0VEakOKWPf4vkNDQ0NDf0ZDQ0NDqruph7usnKi4vWxpVJ271ce5vNjGpoiKZWZlVlZHaGmaVWd8eKuHVs/a5LnHd1lHyFwyR0RZWUdlfL/JueXj53hZ2NiHnn/nuzExNkeHuc2JuTMxdnY9rqxYZbpmc1SHNjExMUVWhmfY2DExT15jZjgyQkZFWEU0RW+fxcXFxra2tsbHusXFxb6PRzY2R0ZGf8XFxqlIRUVGSpm9zU6PxcbHW1ZGRUZatqa2p0ZVVVVVRUW3r8qfxcXFxcXFxra2hpaWpkVIRUVYRUXHfkZ/xr2ff45WSEhrRVuWhmtFRUVFVUbGu1tGNVZFRUVnRkVFpbS1prS0paampbS0tbW1qJmompmotaWltKWnmJmIe2mIiZemppmabXqIp3qnppq0pYmXmpqpGU6Yp5mntLSmhqdod4qmh6ell4lrh48aFBRfh22WtbWmpYcYFBaGmZeneZl/FBQUFBQUFJ+mjD8tTxQUFBQUjz8/N0VFRUZGVkVFRlx/7/3Jxra2pra2t51sRkVFRUVWZWV6trfqbd/318amiHeGlZdHv294R1ZVVmeq7PmneFq2ppWGjHd3r39XV4z771VVVVVVVWpXVVbHp3p6h3podoZWVVVV/FVVVVVVVVVVVVW9VVVVVVVVVXlVeXiJemh4mev9/83LfHtpWIy8////vnloZWVlZWVZmne3yam7elhlZWVlVoquWWhlZWVlZWVlZat2ZnaHh59WZWVlZVb/aWVlZWVlZWVlZWV4ZrfX+9xlZWVlZWVpWGVlZWVlZWVlZWVmiMjozFZlZWVlZWVlimVlZ3dnZnZ2Z2hoeId3ab7f74x3dXZ2d1ZVZ2pWZWVlZWVlVmdWmIf/z//9hmdnZ3lnaFdniWVlZWVlZVV2V67v/v3/hoZ3WGhoeHaHhmVlZWVlZWV4VqfdqPz6lnaHi3llZYplZ2VlZWVlZWVlWGd3eXlWZWVlZWVluMTEuYucydPT08eqbarH09TGrNfIupuLi4l5fZm3eI3D08lrj5zTxouIqI2OeomLMzVXWFZnbKfGq6zT1NTTppeXelY1MzMzMzVta2lKVmd5l5uZt4upODMzbUh5Wls1WUgzSjN8MzRYZ3iGaTMzMzMzj0hpMzM1nqampqampqampqampqampqamq08cFitPmpaWlpaWpqampra2tm+3tqalpqanXxYoZmZ3d4eWlqkvpra2rRautra2pqaWlod3KhgqX2d3lqamlpiPj6mmtrW2pqaWd3ZcJSUlJSUreZdfJSUlJSUlL6emppaHPyUlhnZ2ZmZmZXaGlpanyvv76cjIuLamtqamZlVIape3uLaorFun/f+ciamrh2dHipV2aFqXhYWGhpa3/P1nt6tsr7ye/3dobIdWS3dlVVVXeHh2lupsXkNDQ0NDr2xDQ0NEQ293aWg3Q0NFR5hJQ0NDQ0NDX0NDQ0NDqqalpaW2jVtpaEhcrLW1tbW1tbW1tbW2PH6XlpaGlpd6fW67xsXFxca1tbW1tX9OmIaFhYV7R0d6l6W2Xz+85ua2tqWlppeHhnV1dUlWZmVWRYiXpqafFyUVJa+MP4l2XXd2hlZtGRduR4d2fxUVFRUVFSWoFRUVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV9vb6j1VVVVVVVVVWVlZVVVVVVVVVV6/3l8r3+lZVVVVal4ef7e2NWVuey3xp2rmYdofo+p9VVVVWVY/33Ke42WtqVVWumHeHiHvJu1VVVVVVVb33uJiPVm1VVVVWVVVtmIttSllZeGlpeai2vI+v1tXV1NXFtaamR0VVZXZ4x9XVxqlapsa/XX/VvzlIdWVFWDhGVXaZb5Zvd4VJNK/MOEzEynd3SZWHNzNcRGvU1VW31DQzM2ZnSJfW1IRXh2VUMzOcdYipjjOp2DMzMzZ7bYiYxamGW0k0aoeHe6q2t7fG1efX17e2pbfI1tXGtqepl5Z0c3rFnKenhnhnaIWo6YhvWZ13qdadWWhouZbFrJZlerfmn7jLal+drWy7Z1dHfGZux4Y5Nzl4Tqd4NzIzep/auYxIOTIkMkg2eZYyMks4NacyMjIyMjNLeVkyMjIyVmd3eL3dvs+fiZeXhpaXd4eXmL3fzXh3WGlqRVRUVFRUVFdG3/i99d6nqHdmVnpqiVZ5WVRUVFRUVFSXRbbGxsb+vKfqaFlYj1bfh1RUVFRUVFRYVf63ysmlvHXMfEdUVIxWrVRUVFRUVFRUV2l5imtGVVRUVFRUnWtrRlRUVFRUVFRURlVVVFRUVFRVWouL3arFuH5UVFRUbenFx6qKeXl3h2idmpq6frb35vxUVFRI1dilz11cZ4n8/Ht7d1tWVEilp9dUVFScpfaPVEZ3xnZIVG66vIZUVFSMVqtUVFSmn/9UVEZ86KhUVFS3+FhUisu7mszd7Y5+anZkZGVVVlVVVVdaWklINjMzMzMzNUmXqGhmZkaWpNaXRUR7i3lXNYq25PX05lozM2mpr1WGhYSkRFXrZ6qIVHSW2ur21JR0Nc2Mrp1EqqZoRc56zHmXlXs0MzMzSLVkZ6uZzG42+4ltfjMzSp6r+NfGmGlpu66MV2uu721XVVd8vn2c+Pf3q8x2aXdHVFRWibp6vpnGt0ZUVb18yYqanYjrmklUVFTa+PjZWUh8r1lUVFS57J28m7upa1RUVFRUVFRUVEhUVFRUVFRUyoiauUdWVFRUVFRUVFRUVFRUVFRUVFRUVlV6VVVVVVVVZmVldnaGhoaWloWGdnZmZVZVz/9KXUZGVlZldYWWpsj41raFhXZmZVa//fyazb9VVWWWy4aFlqe2l4aHeHdXWvj5z1hbfHyfamV4vIZpaGpWVVVVVVVVr9z6VXlXRlVVVVZ7rmZFV1VVVVVVVVVVnKtX2fr52tro6Ofo2snJuqiYmqy9rJqbqrqqqrjYycfIv49/f5+fqJiciJeqqbi52bfcl4eYuUhFREREREREREVbRkZFRm2uuri3mYmpRUREREREREREREVFREREREREREVJRWtGREREREREREREREVFREREREREREREn//PalVVVVVVVnh3h+v9/bqZZ1d5r5+/Zr38/cz831VVVVVWdtuJVVVVVVVVVYl4VWj4/YxnVVVVVVVVVXhnVVVVVVVVVXl3VVVWVv5VVVVVVVVVVXiIVVVWZlZWZploVVVVVf5VVVVVVVVVVVV5iavMimmc63dVpaWlpZeHeKalpaWlp7a3tsbGx51+q7a1lYWFhXWYnJWVeHmmtbXGyJ9sxraOtraWdXV1ZVh2iKd6pqSlp6m5ysa1e6htpZaFZWZ4mSs9nqa1taiIim9PP09vqJuId3VlLEltFBQUFBQVX7aPFBQUFBQUFBUqFRcYd2hqbFtaeLvZ2I5sRUVFVll82ufJeGtqIyZfv79/NUzYr0VHNkVUZHZDacVWhdtrVIO09PTDpHSb59pcNWWFpoRYOJeWxNo2U2aaa2ublmNTZpdZvItJyErWi2nl1egziSMiIiIiI1dGmIS2yEiYjr5qiZl3dHWFiYeIiZinxamaqMbFw7Ozxbe1tJpqRkdYNkmHtrV3iJW3l6i2qFtpmMeGu3iIWyVMuIhJicaLqpaFxJ9tpqZ3eoeqxopJjcbCbykiVXqbtrnGjidLpsWPusOKiJ6oeymKIiIiayYTipuNbCIiIiIiIq+NR0dcIiIiaYq6yMa2qGpYQ0VGaGZmVlhZeVdWV1hYp6jGraenubxXRXd42/aneGSbVK9WmdpYtt2El/X19fqNRmectcto2llEa2ZDbLuXnZ1XenpmiGtDQ7z2n3pZj3+Kr0NDe1V/h0ZDQ0NDQ0NDQ6r3aUNDQ0NDQ0NDRIZmura2x8fHx8XFxcXV1dXV1cy+bV1aXH+fWn+Xlpa4tqenuNbV1dTJamZlVkVGSEhIRjZMp5aKZmZlVqvV1NV4hmZlZjZHV1hWN4/VnY+HmXqYd1bW1X9bXFxpeGdJSUhHNI+3fTQ0NDQ0N3jHnzQ0NDQ0NDQ0NDQ0R1ZWWJ2fbKeVus6dnL29+fr767q6fGh6aGdFVVaqjcX12It2WFnb5ua82thrv0ZmZoiaZlRrfsbYdllkdXeOdfbp9dpliFhVRFVIRFRVatRmWH6GRkNraL96eI1VWFlDQ0NDQ1Zma9aGQ0NDQ0NDQ0N7VFZDQ0NDmll9345ZVVVVVVVVWHiIaFVVVVVVd5eYaGl5z617/5u/aGhXd4eHmIhWVVeM2dqs56pVVVVVWLxor7rvq/7ux5dWVVZnhf74hlVVVVVVVVVVVVVV+fiGiFVVVVVVmceHmFVVVVVVVVVVVVVVyOhmVVVVVVVVVaaXi1dmZGVWeMjYqnp7jOj5zfrpillomcjHalRUVGRWe9lldXaN2uicqIj6unypd2qNhpeHh3p1a2tkWWqKipnW9fanjbb3lYWHQ0NDQ0aWVmx6RENDRFrHr9+veazJm4dEQ0NDQ0NDeUZDQ0NDQ0NDbURIvERDa0NDjI2d2ce4q1dUVEZWWFdYZmdXZ2ZlaZ+/n8nn1uf5+9pVV2dmipqNqoWIdWVn3ayMeYmXdnV2vstURXip6f6d7H1UVHtEfqqOdWd3Z1ZVVFRUVJns5oufVFRUalVUfUSFd1RUVFRUVFRUVFfJjVRUVFRUVFRUVHh3aZmYpKiJu8amdWhoeEk6Wmt+XEVEN2hoW0tEY5WI6qSVlNeNimiLvJiNfHw0JTmLx8W6U3WnuJWke7ZmhoZ3WbbXu6h4tabHzFNrN4amnbrptmiOxsXKxLbc17S3eG14IyEhITrPS+d6nyEhSCEhIV68dFs4ISEhRUVFRUVFRUVFRUVFRUVFR0ZFRUVFRUVFXbvX1ubXzm9FRUVGj83o9vX226pIRUVFdpa31+fGppafRUWaqMbX5vXWxsatSUWKZpxeRkdtm3dmiI2Hlqbdj4/PtqeWqldVXEVFRUVFRUiIfJmGnUZFRUVFRY2HeImaV1ZVhZWn2Zttvs6/rnWFdYenlmVlVEVFpqZoVIennrq3l1ipmZmZqKupu2Y1V6in2fhNOIXMV7i6nYdlhZZni9jNy3zKyleFfjWXV5fJhtaJumZK5mudqG+Ml7q5NSMiIkcibKfsIthMeyI3JSIiIiM6VCIiIiIiaUhINTVWh2hHNFus6KeWhpaXlmdVVVhYa8+eeZlId7i7a0aL3Nb09PXGhK/Z2nzdWolnanmMh2WHjDVG7Mfz9PacZISpV+d3V1Z4Q0JCQ1eJvTa+iG2vVFNkZpW1dGpWillCQkJCQkJZRliLaHnKnkRCQkJFr2tpVVVVVVVVVVVVVVVVVVVXWFVVVVVVVlZVV35ZVlVVVVVVWXyea2uL+NibVYzY+L+Li7z39lVVVVVV+PbPnayLq/efVW74qoub+J5VVVZVVVVVVVV719/LWFVVVVVVVtyfa8dpVVVVVVVVVWjqv2n4WVVVVVVVVdlpZGZVREREVVRUU1VWhYSFVkRERERERVVliXur/H1nV0eXlWdEZXVDRWj89salhaeGu4b2hmyPQ0NDRWarzWh87flczGebeGfri7tHePm9Q0NDnXj6dfdq2puGrJbuzpyMWJZDQ2j7Q0NDd3s2en9cfIvveIupWUZEWGVlZWVlZWVlZWVlZWVmfd/fysu7y8+eimplZWVlZWVlZWVlZVb82az7qayIiJyuaGllZWVlZWVld2dlZc/fvXp9zWVlZfzbaP6JrWZlZWVlZ4dmfL+ce2VlZmVlZYplZWlmZmVlZWVlZWVlaGVlZWVlZWVlZWVlb1ZWVVVVVVVVVVVWV2hsn66u19fX18uvnVpVVVVVVVVVVVVWn/z5+PzJ+ufXrVt5aoxVVVVVVVVVVVVYmlZVv+j36vrHVlVVVVh7VVVVVVVVVVaMVVVVr+/752y/VVVVVVVXaFVVVVVVaGhVVVVVVVVVz1VVVVVV3o1pZ4h4aomZ2/vtju/8vnx6d3Z1dr7uVleIp41VVVVVVVfYuY/fh5WWhoZ1dp3OVVWJiFVVVVVVVVWZV1Vbz5a2xpZ2Z/pWVVVVZ1VVVVVVdnhVVVVVVf7XtoZ2+lVVVVVVWFZVVVVVVVVVVVVVVVV/z/zPVVVVZ2VlZWVlZXV3y9zc6evry3Z1dXZ2ZmVlWnZ2d3ZldYvJtqWHlqa31/irhnaHh3a/R1hnZXZ2dsqWl2uHipmKt/j7loaXnmdoREREaVl2eMqWj0VERERFmcf9mHePWkRERERERERFe79HRURERERENp//mm5rRUREakdHRVhqaWpYNEVVRWp8fXpraldXR0hH1bvV1caqR1ZqRVVaeWZafZempcbFrMfVXFfVWZ/lu6dVZWdpl7a1xtTX1a7kjtWuQ11pZVRYjOXFtcXFyOVd2W6PfzZpZ2ZnQ5o0hzd5QzbV1dk0f11DQ0NDQ0OJRLhDT6mmpqampqampra2tqalpaWlpqmOLCoub5aWlpampm9/tra2tre2tba2pqZfJiYmdnZ3d4eWmyYptra2TyY/tra2tqamloZ2KigqX2d3lqmmpqedjammtrW2tqaWhnZsJSUlJSUqeZZvJiUlJSUmPqa2ppaGTiUlVVVVVWVlZnZ2hqenp6enp5aGhnZlZWZVNTRHaGZmdZa3+f/ZyMn7+ummhmZVRUU1iHhYr49eWYrY+8mciXh2l/z9mKhqNEVnVH1FaVlYWr+2yWtGWVRWaJaFdWZleqtVVGeIVFRUVFR/64ZGWFRUVWxVVFVYjVRURVZnmoio1biKzv/vmpeouHuu76ubr2lHREVodpdolZWYfv+4aliXqfy9t3iGRkVESUNnVrrFd0WGx0Z5Q0Y1t9i6iWnaSZeMRUNDVqe1REWWZ5hDQ8tt7HioZlbu6GdnQ0NDQ1XGQ1aJQ0NDQ0NXmr8mVEaJRkNDiYl729nZ+Zyc6b2OrJyMenppmKi4m3mLy7rJi0RDQ0Sbvtqd2quXrPh46ctpWIqpinjJRENDVmpERETpvIhaRn34fENDWGjfe5enRJxDQ0NFhUf4mb1EQ0NDRENDQ0NDaJeWd0NDQ0NDQ3ea6Z9DQ0NDQ0NDQ0NDZ2h2h5qLWIeHaoubr3h3d4aGlnV1ZmdnQ0Vndmamq5mHiZ+rroh4q5mXlYdVV0ZEe0NEV1qleEZ3m7qMRMp2pv//zW25evn3Q0NDRFe4hkamvYhDQ/+vqlpJ6oX7ZmqtQ0NDQ0WWVld5W0NDQ0NDRGtWZXlXQ0NDpqWklaWlpbW1tbS0t7iop7i3xcXEtbWlZ1dmZomop6WltaamprZ/bkpvtsXFpodXm24pV4h3drWWl4eFeKjFtV85p8fFmoqYb0sjFkqHlpWXeCY4eHlstp9EVZ/FtqeoOSMjIxYWKCkqbSMjnio7jG0nJDp5ajs7VVVVVVVVVVVVWJ2tq6y7q7u7q6y8z2lWVVVVVVVVVVVVVn7L2+v4+PjKfHrO+9r//FVVVVVVVVVVVVVt3mn49/pVVVVVVVbPVslWVVVVVVVVVYhtVVVV+H5VVVVVVVVVVVWKa1VVVVVWr1VVVVVV71VVVVVVVVVVp5ioqamomKenl4iJq6moqKammpyLfImXmZmYiKellrS0paaMpqaoiqWlmIyWi2yJfYeleaeklaW0tJalpo8YFIuWl2cXFRMWE415l6allpall6aaFRMTpYuYpoubfxMTExOIlqurf6empZkTExMTE5+JfqWPExMThXWFhpWVlaamtbW1tbW1ppaVl4Z1dXV1paW1t4WVp6i2lpWWlpWWhpeHaXhrqaalp7WlqLe3eFqMa422qJiYmHdpbX2bp5iYn5e1pmmXp6mZiZimp62tbIxrm28EBAQEBBlrmYoEjwQGnW+dBAQEGY+/BAQEBAQEiod2dpqtiHh6y9ve/765tqaVlYWFdWZmVUqPr3uWlrZ+ubz+77fG5/e2hnWGd1VYV1VYRUVGn6fG9ul7i1d6q7h8vmdlVlZZVVdEREREREX69teGVVV4REeaRkWHRkR7dkREREREREREScl2V89ERERERERERERq6dyseaq6iqu8nb/fzYaFlpWVmPr469zraFVmZXaJe1q9nLzPid6Jid36qYZ3ZmVWREVnRVf+hZWVlYdHRERERER6hZXaeEVEREREVmaqn1ZVRf9EREREREREa5VWWEVEREREZdpYaHiJZ1RERERERERERIt6aEZEa4mId3WVpYh6eGqattbY5tTExbaZrL+OWEY2aruubGu6xcZp6tTLfXp/9KjoimdEaTIzVqx6eZWJSnl3a5uX153L70eGNjZmNzIyVomFSOTF1UYyVkUmSsxmr1ab1ZY1MjIyMkdZNLZYhjIyMkiXuVszZo+cdlQ0VmVlZVhqnmtYRlVVVlZWVVZnecvLmZt6ZWVm/+unmIl5nP96Z2eHppbb3Ozp+vqZV79ndslWZWVlZYusZVj86VxlZWVYzYZWVWebWGVlZWVlZVj5WmXZ72VlZWVlZWhVWWVlZWVlZWVlZWWud2iJZWVlZWVlZWV8moaHeomYqaycfJzOfHmJmIh4eGVlZGZ2aYplqEZ3VkdWy6pWRY7Vx7jup7Vlef90Vf+IRMpWVpppaVZo/0SKx8mmy8u4aGdVV1VEeWhDREdkaPxXmmm8RnpDquqLzjWLQkJCQkJWQlVD6plmQ0JCQkJCQnlaWXhE3bt5WJqputna3OzLnMzMzLyKaHqcrEZYRURERHqaRLpFzFeJi8hqWa28Vs1FzkW8RERERGaoRHqJ65msREREREREy2Z421dWRERERERERKm6qeucREREREREzav46diZRERERERERIh4eHlERERERERERL2c+7pWeml6aUZGaWpaRldXVl2NuK2PqoiXlpeJhIWVmJakanZpmZeZrrh8zuPJ2GmbfGeHaiSVpajJJZp4iXc2qbrK2/Tn1ZhHeIV2MjJ8t7h/MjZ8m6x3iWpc59nkyXfWpYNqMjJ/zNQ3MjIyMyg4WSMjMjIyX5Xklkcy+/v6/2lVVFVWZ5uKeYqMzLubrJmZq6u8/tx6VcpnVFRVV6uKapx8VlRUV5y8rWnMVFRUVFT9VFZVaEjcrlX/i1VUVGd5q6xoilRUVFS8VFRUatlUVFRUVFRUVIpoVIu7VFRUVFRUVFR5mMxUVFRUVFRUVFaMVJlURFVVVGNjZGNjZJu7ysfWyPb12Ozfe2dWu2pYaIeadHVWaLyvdWRWVntHrOplZVaK+It6dndIz8ZnqWxlZVnO7fj1mbpWWIyFqtxnVFhWf+jayat4ZZ99STRZ9npkSDWJMzMzMzN6jFjXi40zM0czMzMzf3kzMzMzaXaGdXVlVmd7q6ucubi3up99aXh3ZmZnyn12lJaIm1l6pbSlmLbE1NTE1MpmtpuMdaenhrfGdVZVu6hphIV2yNW2xcRHRFREd5Y0jKl7RX1Zm5V3mpWV1NO3pJp5RTtmSlpWRnsaAgICB2+2CQMuyz9/TalfAgICSTc5aXlqqbbF1NTUyI+dnFpYW0dGRldGV2hHRnetiKS0xtTU0+S9d3qdjYlrRUdoaVdXZkdLmIqpn7q71MV5a3trm6qbrId5h7bKnDOXi5pqal+6nzMyMjIy1+TT1bWVMjIyMjNeSmmYqpi7NjIyMjIyN8jUxsdIVVVVVVVVVVZWZ2ppmnlpZ2dWVVVVVVdWVVVVVVVVVWept5xpm7iX/+1qipiJiGhWfv9VVVVVVVVXeaqXprn/aWaXpli6epqfaFarz1VVVVVVVVW45+f9VVWWp6Zpav9oVe+/V6xVVVVVVVVVlvn7VVaonFZVVVVVV2lqWXmYtrW1tbW1xsbGxcW2pqWmiVhWlaamp7anpouIlolnmaXZ9PTnt6WJaGh3qoeWp6fHpXpqfHjNeYy/PU5fn5aIV3alSmyvi4y4d1abaGetjyQjIyMjI0/ddopZIyMjIyWPmme3zUskIyMjIyMjIyOqmCMjRERERWdmZGRVaau7+fr5+dyuq2hoZ1VVeYmXh3hVRVSJqnWlx/irqvj299WmloerrqtZzEaeiUSXRGa5jmx6aHh768iZnEbPfGZnd2jfV4ece4t6ur5EQkJFrqqdVUOMQkNFQ0NEq0VWRUVYQ0JCQkJCRXhEQkJCVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUV5qJrGt6VFRUVFS8uolYvNlVVFRUVaybi6ibW7xsiVRUVFXLl7hp6IlaaqqJi3fsaIlXmItprYtUVLqL+8/5rsv+eohH67rbVFRUVFRUVu1UibpnVFRUVK7+/uyJzFhU/L18So/N+frr286eemZXR6zsybW1293sWkWL2klFSL1IZVWs2Npqibl3poWX7JXbqJlld3aaaH2qmsl4l5qmeIzKVKZ0Z4abdWhERUWINmW/Rq1ni0NDQ0NDaniUhZiHQ0NDQ0NDQ0ZFQ3pDQ0NDQ0NDQ0NkVVhWZXZ2ZnZ2hnZ2ZWVlZWVlZWVlZWdoZ3Z2dqq3t7i3qLmnhnWGloamtramlmhWZXd2p8l3ZkZqx8Wnh2aLrYbZ1/XY15hnZne5tsaXmJiZ27uZl1dHaJiYr4+fvKZ3V1enqdfmXwUUFBQUFcxnjS8UFBQUFBQbX4+fhYWFhYWFdYmZh3d4eYqamnh4ZWVldoWFmNjYqLiplZWXtbWldXV2pqalqGZlZYaXiHV1dry2taa52aqGZWicqPfZtYZWVWasZaeYp+jWv08WK5+IZtotFk/Pqoaah5iYf7bZbxYUFBQUyF/LiyoUFBQUFBQVFRQUd3dnd2dXWJiX3f//iYmJaHh5vv//eHd3ZmZmZmZmqVjK/byaZmZmZmZmZnn/iWhmZmZmZmZmZpiK/7tmZmZmZmZmZmb/iWZmZmZmZmZmZldI72dmZmZmZmZmZmaseWZmZmZmZmZmZmZnm2ZmZmZmZmZmZmZmZmZmWYWElbe3uurq6MjIy7y6pZWHj6y6urydpSmJyaa32puIe5Z4ipW8h4W1lqh5qZiUjiI2fJVefKObiFqJrKWahpmGb5amSXqlhCJqOFo1hjg2Wnm2utXKtZfNqUlsqSM2IiMiSFkjIyIiIiIiI5qPRrhsIiIiIkkia4p5WVpqeouqqKioqXqKq5utWzUzMzM0nJqaqUczN7nFx8bFtpmre6tcMzMzNHyaqbnFtzQzM263xrfGxMXFi4tIWDM3nZiLtsW3xjMzM36cxsW1tsXHfciaNDO3rG/Hfp/GtkkzMzNHMzW4un80STN+MzNbMzMz17m6m7nJu5iJq7e3uLuNjNrX57q6qqm5e1hsWFe7ynuYqI26q35bRERFRb3XydZbREREj+nW1756rEa718q+WEREn1jm165ERERERERERHx7r0RERERERERERETYyURERERERERERERErkRERERERERERESOyUREvf/+mnh4Z2d4mIlpecv+/v7dm2eK/4pnaFRUVFU1Rv1pru1GqHh6ac/Mds5nrHjvVVRUVIdWVHpIaKz/VFRUVFSGulhX/Wa7ZlRUVFVVVGdnaFhVVFRUVFRUiIzpuPp4VFRUVFRUVHZmaZxUVFRUVFRUVHd1dqpmrZp5eZiou66Ne7zbyby7q4tpV3qcnEZXRURERHqJRGlXimp6a6d6ap2LVqxWrVWsRERERLqpROzry3qcREREREREm5iJumZWRERERERERMv3+PmtREREREREy7z359i5RERERERERFa+275ERERERERERLrX6epXtpqabGprh5aWh3x8i5iXpqWkpZWVtra2x7W1p21oaYWWlpemmae2p4iElqXFxdXVxdWPfVlmZ4WHh5imtbfHyGqFlZm3j3/VxF5GOldVKWV3h5dvtrZ/xsZlfhUUFBQUxzsWFBQVKUpJZneKmJ8rFz6PFBQUFBQV2ZiIaDVFZlVmmMipR1VFeczei4h2dqrJzMp5NGXJnURl+u6Hmprc7c2sd2Vnh1U3dVf620ZEVVXMVzPKj2iYiGVFa3v4d2d2RZdVVoxEQpj5Q0VlmIZZQmZau7tnekJkdkJCnEJCV7xEQ776r0JCt4lCr6m9RFZCpqaWlpWVppaWh4iIp6ampqalpZaWpqW1d3d3l5iHhpanhoampqWltbWlpqamloiXdkhGVkZJR4aGqHilpqW1prW1ppaWppd3Vmo4Jhc5GCdZV4amppalprWlpaamh3dGVx1KD1oPOA8PZmdslp5vT6uPpY6mD28vZGVmant7zL6+3P39nHtpZ2RkVWZWVlVVlodlVmeM5vebZ3dmiJh6yuqf6odWZlVo32ppmWWuesz4955mmPj5zFZXmo16VkVDVURDQ4tnrVZ5vXjLhe9DQ0NDeftmZ3lXQ3lYQ0NEZWVoeGaJeUNDQ0NDQ3ZkZ0NDd5moxNPTxLS2iXuLq8XExMapZ3doSVhpVkZ3pMXE08Snp1eHR0VniFdXmGc2R3p3e0VWarrE09LDeZg0IydEVVg0NZc1IyMjNVqNuoq41caYZzQ4Jsqf09I1ViUkZ1M1uLu+r6+fuqupnmpmOkuMr6ldSjs/fXmLmomJjcfWy39tmayfj9XVuLe3jXqIqJioWkZ3h5bYaJemmMS4d7nTx8abqYZWh4a+RolFqHeKV3WbpcbGxcbUuKmrV59rRI5oWWZW1Vp0hnZVV9WLpr+oIyHJN8c4eTl5IUkmilokTCEhIV8lSyEkISE3ISghSyE3y4t8VlVVVVVVVVVVbMzJt5eXqpqamrvLWFnJ+nxVVVVVVVVVfNi2h4iFu1d+3JqeVVVVm/ptXVZVVVVVVejHl6fNVVXXmbdWVVV8eGuLfVVVVVVVVa/G191VVVX4uvlVVVVWZ25VVVVVVVVVVVX4v1VVVVXPydlVZ2ZlZWVmZ5uaq66fno16aY2/////rIh4ZWVlZWVlZWVYvWhlZWVlZWVlebq9rWdlZWVlZWVlZWVm3GVlZWVlZWVlear8/KtmZWVlZWVlZWVmrWVlZWVlZWVlZa37+79lZWVlZWVlZWVlvmVlZWVlZWVlZd76/IplqHhXVVVWaZqJiZqJeVhYV4mnl83Nl5aWfVVVVVVXqfu9WldWfu/ceVVYyrft2vroVVVVVVWs/HxVVVVVVVWvy1ZVVf/759hsVVVVVVXvyVVVVVVVVVVV+1ZVVVW+x31VVVVVVVWefVVVVVVVVVVVvllVVVVVnFVVRERDQ0ZXV5mJiZeHdlZGaGhnhoSFh1hHWM6+qoR7REVZealphGp0haWohop7u4RnuryFan7I2mrfbd1qhpZ7fPX0mXp3hoaWmYWM2eeLRENDy5qrd+tEQ0NFi82arKyMfOnf20NDQ0NDN/dIiVpDQ0NDQ0NDQ0NDRFVVZnZ2h5eWdout/fj39vrczZeIRkREvGmfVmfedczMytuuyamaiKuFZ8rnh+m5dcqqjK1mZnhmVr/rhneJiWSpq2ZVZ2WaikZ7Z4hHd55IvJ5HRo1rRHu1xlRFd0atQ0NDQ0NDRkNDQ0NDQ0RDQ0NDf1VDQ0ND5pppVq28x9bY2dbou2d62dXVusjI5bm5nVWs5qlVatrazNiH2mj2elWLi7tonOiNVWZWfVdnWmVWWYmsnndmaJp3dlfNaWVVnEdsZotGiI5Gra9KOKtbSJyYlkM0V0Z+QkJCQkJCV0JCQkJCQ0JCQkJCSFtDQkJC3ptpVmZmdpaXiJq7mIiqzat6V4u9rFdqRVRUVIh4VapFzUbMiodpWa3MV85GzUabVFRUVGZWVJvL/KrOVFRUVFRUzFZn7GpWVFRUVFRUVPr5/NyMVFRUVFRUnLv6+tpUVFRUVFRUVOy7qpxUVFRUVFRUVKzM6olUd6y97Yh2ZHWHy97Od3h2d7zd+s2LZWV16enr7K38uuzczPn4+flmVFVmeFVEVXj7ZlVVe1VmeWRmV2dkdqybiWpohlRXVp6arVaNaItXiY5Hva9WRqtaR3uHl0REZlaMQ0NDQ0NDV0NDQ0NERERDQ0NDR0dDQ0NDZ1RkVVVWVVVVZmVlZVRmzs2rafz8zf7Lh5eZd3faVniZ/XXLhqv+/vztiYq8zXu7VXdVnFWZiYW6ZnaYZomGaIlmhWVVd3dmu1eKd6tXub9p269WOOuNRXuGtkREZ0XfQ0NDQ0NDV0NERENERENDQ0NDWEVDQ0NDmmVlZrrp6Zuau7u76Om6hrrb2un32+nqVHdmZXZ1ddyZq8y7dWZpaIeFyulkmullRFZXrkiLmlR3elh1VEV3imn21mjZmWVXilhqV4dHdr9sfJ9sS6xtQ0d+hn1YV0WvQ0NDQ0NDRkNDQ0NDQ0NDQ0NDQ8hHQ0NDzd3r+fvt3YiGhXVlVFRVVFRUVFVVZXV29s+ciJnLzPj4u4e7nHdnZmdleFVo2ej5VWVWjmZmZ4ba7szbinmK2nhpd2hmVXlli1dqeJlXh89bja9YR5xtRFl7hptEZkavQ0NDQ0NDR0RDRENERERDQ0NDQ9tFQ0NDnXp5zPfqeHqd9vfbi2Z52vjqqodmitrpVWe793pVh2RTi/S+VOvNZWR2mXVUVGfbvNpqa2iJjIV4VorM2mWHeLmaplRUenlojUaOZ2hZmZ1Ivo9XNr5bRo2mtmRmd1Z8Q0NDQ0NDV0NDQ0NDRENDQ0NDSGdDQ0NDiXiKrIp4eOz6vXeb+/rdm7zdzHdlm/v7rHnc/a1lnJyKi3l4mqx3ZmRld7z5vGfsZWVli1VmZmRUd4p2V1VlZruKdnj5imVVu0abd5hWlcuLnGxWN8tpQ0ZZeFNEZkWLQ0NDQ0NDVkNDQ0NDQ0NDQ0NDRHpDQ0NDlYaFdYeYmLmpqsvaycu7qqmpl5iHhYWGt8nKmIeq5umXqZiYt5mYqpja9bp3mbq4iIqXnGeJnIVlV6rY59m5l4aFuVVUeXeIm0hcV2g2aI84nn9KOn5Na6mn6URFSjOfMzMzMzMzRzMzMzMzMzMzMzMzn3gzMzMziop6eoqbiaubiqrKqNnK2/f39snZy5uLubyLfHVUZWeLvMvn2OrMvIpoqoiu3urcZFd3jFdod3VVar+4mVhneva4dVNFZmhVqkZ6ZoZGhbxqi25XOKpaM1qIpWNEVjSfMjIyMjIyRTMyMzIzMzMyMjIyR2kyMjIyq9no9PX3+PPz8/T23JmJu6yKdneL7My8dmSrmc9nm654h7plZGaui3dl+2ZlZM9mZ2ZpbHpnanV5Z2lnZnh4aJtoeHl7aXxorUaMaHtYiY5Hq69HRptaRWx2llREZ1WOQ0NDQ0NDWENDQ0NDRENDQ0NDR0hDQ0ND3Z6dam2evIqYnNnm5unJ1/b19fT05ujol4tGblZXaFR2rbbZh2aFy4dlvJio2reHVYlHfFdqWnVVebh4VkRli1ZofGRXh4hVjEd9aHpHiY9JrZ9qNm5WmIeWfHhlp2ePQ0NDQ0NDWENDQ0NDQ0RDQ0ND6EpDQ0NDWVZXz516U3qdz2dmeN3b19bW1tbXyd7P3ItVd9qot6fqZWXqiIWpubi4p5iHmIZ3yZeYfGd2e3R3WHjIlZiFmcqnpnV2toh2W0mNimpIh51Jm39oSp05SI7G1VRUajZdMzMzMzMzVzMzMzMzNTUzMzMzfogzMzMzq9fmvYaFqqmHdWVlm5u7ysnYyqqIdoeZ5pfLyqja1sq52MyXltrk1+Tj49tld2W6d6x4fHipfpWKaZeVd4l3eoiHhlRXiolXjTZtV2tJin83no9ZOZ1LN26Ip1REaVd/MzMzMzMzSDMzMzMzMzMzMzMzNlozMzMzZlVVVUVERWd3VmVlZWZmZmZmZmZmdmVVdlVFVWVVVVRmd5r9nGZmeP75m2Z5fP//zP5mzVVneHZ3nt95Z4qZm3aI/4lodnmLnHi+mMpnpv+K3J9WWLxaZpiH3kVFd2atZGRkZGRkd2RkZGRlZWZkZGRkrGZkZGRkm9nm5Nq7rJy85tnMi1RUVWVUZlVVVWVlyeXm5uScipro59rl5NjXqrqL55vYvLuselWdaWl6fKyde2loZXloZnloZkScZ45VbFeOikpaqo9InI5GN75JRmplh1REV0V9Q0NDQ0NDaENDQ0NERENDQ0NDSFVDQ0NDq7vJqYaYx9bIl6eXlrm6u9fVx7uriIeHuci6ubmmyKe4uJeohXa5yMnIx7mqybmpZoiHbYqoj6aViZiFd5eWd8iopWRViGhWfjduSVo4aI9Lfm9aPa1KNV6btWRGeUdvMjIyMjIyNzIyMjIzMzIyMjIyJI41MjIy1dXVvZ6t18fHyNXW1tXW1tXV1dTU1dbVy2Zff1pJnnaFqrmWx5h3u5t2yqiIuqmGmWdYbUZIW4ZmaKmGp4eIiXhneVZGeIdUfEdsV2tIeX9InY97SItKSH2HmEZFaVaPMzMzMzMzWDMzMzM0RDQzMzMzX1gzMzMzqKmYl5eop7moqMvr2urr3Ov62uzMq7rKmKqrvKzKx6iGhqaGqIeGhoeHqId2hoanhnmnnmd5mLZ5iZd0dmiHeHaGhWVml3hmrTd+aHk3dr9sjn9XOJtcNX62xlRESTSPMzMzMzMzNjMzMzMzMzMzMzMzTGYzMzMzt9fo6vzceVVVVVVVZ3iKrf772MfGtsXFemVlZWVlnXtUZu+eZlVl3/zsdnf6+fitVWhWjERXV3Zmv4lVaopnaFtXaGZ6aWhGzVaNd5tXl79q3n5FR99rVnmHh0RFVlaeU1NTU1NTV1NUVFNVVFNTU1NTV0VTU1NTzJuIZneIidzLqbnY9sjIuenousrK2vT02qqcVVVVVVRldbvJuqplZFV4V1WGuci3qop4f1Z5bnZ3WorJhoiGd72rp1Vm6LnZfUhtV3tGin83ro9LOZxcR36pxkNWd2luMzMzMzMzWDMzMzMzMzMzMzMzNlczMzMzZmVlZWeKmbq62vf5muv8u6m67cvLvc6+VVRlZFRUZJr79bvdhmRUVGVlZav5+phmZniIbFZ5enZnePt1eGhli2p3ZmXviVZlfVifi4tZmK9ZvI9WRqtJV4uHl1REZ1d+RENDQ0NDWENDQ0NERUVDQ0NDWVVDQ0NDVmh67fvq+vr7/YtnZXhneZy9rM2tenqK+2ZWaGh5/XloamZm/K1kZGVU3lRUVGW+qVVWWlVVe1VVVlZVqndliXhl31VWZmdVjFi+q5lop9553I5VR8xYVqiFqEREZ1Z8VFNTU1NTZ1NTU1NUVVdTU1NTilZTU1NTdoiarJq69+nJqol3dnZ3dZm69um6dnZ29oplZXa558mJZXV26fSrhnW79Pl4ZHf0VXiJnXqcnbZ3a5mGd1WJdYrHZ3ZVeVVWmmlZaXlId59Jnp9cf85cM0u/1ZtFWjSPMzMzMzMzRzQzMzMzMzMzMzMzNK40MzMzvamoud69ikg1buzo1tbZzMjV1a9uNWl5XEZpejitlLtLtqVpN16Pj0s1aLnJJovGpZWFhZWFhZZ6tW6kpZSWdpeW1irHjKWJdkZpNlc2W5iEp3mp2Io3m8ycuKWmmblZMjIzMzMzRZs1MzIzMjIyMjIya8tlNzMzdqvJyZmZxse4utbImtfWqqjH1piIyti6Z6vWq4q8yLp4ytbJeMjIyne617t6q+aaZnd5bmaJbYRnWZx1eYaZZrmZdURFZ4lWfUhtV2pHaI9Ii39JOZ1LNG+qlVRFaUZ/MjIyMjIyRzIyMjIzMzIyMjIyNloyMjIyqLe4uMTDw8PFt7e3t7a3qam5uLi5ubi3xMTGuKq5qbipt8XExMWHl4aXp3eHl5rIaWh4XGuMbZaKa6qHeZiqdcW3p2d5ioqbfjdeSFs3WI9KfG9cT5w5IzqPmo1HeVhvIyMjIyMjNyMjIyMjIyMjIyMjI8dKIyMjyfn67fz7yPzNjKu6d4t5bJ6uu6ytjb3ref2cZ5lX+2WrZov9vb2cZq1m+Wh5inv8VWVUmkRVeFVVZ1d4ZWZlVppoZkREVVVVqWaJdphWmJpGyq1GRsl5RGZmVkREVlS9Q0NDQ0NDZkNDQ0NDQ0NDQ0NDVlRDQ0NDqMXFqKmpxsa4uMXFp5aVlri3uKiXhIWGuLbHt7mpp6iYubi3t7fFp7e3tqaoqLipmHiXf3iZf5WYfKqViZimlranpXVomYlpbjldR1s4WX85jm9eKo88OX+ptIVojUlvIyMjIyMjOCMjIyMkJCMjIyMjKYokIyMj1tfX19fV1dnKiXZmZVVVVYyu19bW2MbGi8rKubfH2ebV2ZiJ2Z29eWSMnthWRVZ6VlZWjXiYndfX2q2bd4p3aZx7ZVV8RWVFbVhsV3pHZ59bfX9oR65bRUmNhmhEVkZ9Q0NDQ0NDR0NDRENERENDQ0NDRI9EQ0NDd3V2dYrc/Yl1doiImYZ1dYrO+vj9nJqaZlV5eWVl7cx3dYl1ZWRkZGV3+v2qZVVmRWaJfWd2jPl2i6p4h1Z3ZZx4m3VUZkVlqWmMeYpZu65JzM95bK6PRHyp2FVUV0SvREREREREaEREREREREREREREj2dEREREuqqYucu6mNvJl5aWqJeYmJaWl6eWhYaph9x2har29ul3lYTrdcuYp/qF2qervHbLdomWb2eZj5WWaIeFmIemh9mppWRXd2d4jkhsV2pIea9LrY9aKM5fNX+51mRWeUd/MzMzMzMzRzMzMzMzNDMzMzMzNmw0MzMzzdrX2NjY2sra19nMmoib2uTj4+XYnIaId9jl2ay7yruWq9jah4poZWW65nZlZ3lVVWd3XWeJjZWHeZ11aHh3eWZ1iFVVeVdWfkd/WGpIeo9Jno9ZN51LWZmGuFREWEZ/MzMzMzMzVzMzMzMzNDMzMzMzXlUzMzMzdq3OrXaJ3JuIqt69iM3b2vX12fX2zN6+RVVlurnY19iqymZVZWR2yrnIurqquVVVZliafmeZenV3mqeGeXh2eKqZiGV4ZkR3ilZqV2lImY1Im49JSqtsR3uap0NEVzWfMzMzMzMzVzMzMzMzMzMzMzMzSFUzMzMz3PnqmnZmZWZ2eb/ey3V0dHV1d1VkZGV3zXdlZonfd82qqnib/fne/vivhs35+vv6VmdonFZmeXZpaXeHZlV3eHZ5WGVVZlZVqld6Z4lWma1HvK5ZR518RWmHm1VUaFbPQ0NDQ0NDV0NDQ0NDQ0NDQ0NDbWZDQ0NDac/vj9359Pb4j9/fbK7ermdnZWZov7+NVFVmu3pp6oxX7GlkVVVmq+n29vbpi2VUZWZmabtXZ2e7VmdXZmZlZpx4dVVVZVVVmmeKd4hXh7toyotWRstoVXh2Z1RVZlWbVFRUVFRUZlRUVFRUVFRUVFRUVmlUVFRU5uf39/b29ff25se4x+r495l2ZGV2qMfHr42f286Kh2lXaWlnVWpnVWnsp4xpaEVpeFdWnllWWoiOWI+7V797aFZVaUVYaWp5i1Z8Z4pWh61Xva9YSIxaV3d1q0REWEWvQ0NDQ0NDV0NDQ0NDQ0NDQ0NDaFZDQ0NDusytZ1Rmu+bnmpeXrNnm5+joq8ysnLzL9qxEZYnmrHaWd3bWm9zcvbzL9/fazKzmVWeuj2doWmVnaIt3eFZmV3lmZURFVmZ2e1drZotGd55ZnH9ZN4tKR4t2hURFV0aOQ0NDQ0NDRkNDQ0NERENDQ0NDSEZDQ0ND19fX5ujbimZnd3h5eazb5+fm5ebW1ebmelVld5rL6Yp4eHma3Nu8rLx4ycjWi7t4VWdmbld6a4Wrrq11ZmZnaHhmZVXIZlZVfkd+V3tGia9ajZ9YNpxcRXx3hkSIZVZ9Q0NDQ0NDV0NDQ0NDRENDQ0NDSG1FQ0NDmnd3mZWVlZWlmLrK5eTkx6emlqampsfIZ4u6mKeZiOXl5OSaytW52Mh1uKaYmnjGVXdqTGiHf4Z4fouGiJeGh8ippmWrq52rW0l+eTpKq383jI9cKa85OX+qxmVWbDduNDMzMzMzaTMzMzM0NTMzMzMzN2kzMzMzzL6+vNnm5OPk3Ix6eIqdeJqsu8nJ5ePkVFRnjXpWzrzn2qyaeaqrh3V2lmfa2cxWZniXbHmae3V4V4aGeHeVdtm5hlNUeFVWi0Z6V2lIeJ1IrY5YOr1aNX6ptmVWeFaNMzMzMzMzVzMzMzMzMzMzMzMzNnw0MzMz9OjMnM3q9urMd5vM9ffqvNv49r2cZbzbVJ2bi7u8eGbcZJxndr2reHmJdXm8ZKxmRFVom1V5ZlRoVWd1ZWWHdWeplVacVHpUiVdqaIdGdr1qe59ZW7xaQ0d6lWlEZ0WvQ0NDQ0NDRUNDQ0NDQ0NDQ0NDQ8pFQ0ND1rqZhIWFham71tbW1dTU1NjItre4mbrJ1bqqmaeohYW6ybamqXaFmIaX2Jh1dsnJmIuof4l5e4aJeqqXl4h2iKqZhYlml2Z4jjhvWWo4Zo9LjW9rOo1NJV+rtWVWazd/MzMzMzMzNzMzMzM0NDMzMzMzN3wzMzMzxMeph6m3xLiohqi4xca4lpi4xcW3mKm4uMjIx7iqlZm4x8fHx7eXp7i5l5qqmYmomHiXjIl4e4WIa6iWeLiWp5iYloVnhop3bDZcSFg2WH8pjm9dLI5MOn+oxHVmbzh/IyMjIyMjNyMjIyMjIyMjIyMjPXkjIyMjyMfXuImKvnqKydXWx8i5d3iLrLycycfGiouKu+TIyMrWy4jKVGjV18qat8bWaK2sVWXMzHl1f3R2WYt0Z3dkeol3hVNUaFZVXEiPizhbun43rY9IN75KR3x2l1RVeUZtMzMzMzMzeDMzMzMzNDMzMzMzN1gzMzMzisrKurq41smqyrq6eJqJqef05cbVyaqqemh5nKuq5cm8rYuaquuadlaH9JlUZqzcVGdWbFZ4n3VoWYiFiMqXiLqp2VRGaXhYi0VrV3pHiX02nJ9ZOJtKN3+41FNEeFZ9MjIyMjIyRzIyMjIzMzMyMjIySFYyMjIyyOna26u63LvMysnY2Lm5y7qqzLma2dfWd1VVVGSK6ZxnZGXoiFVkZHV36ptlVXj3RmdHjVh8jHZVWGjniVd2VI3YtlloZ2bpq0hsaHlHd75amo+OSaxsQ1yMlY1EaUWPQ0NDQ0NDR0NDQ0NDQ0NDQ0NDQ+hHQ0ND2tjairy7m6us2OPj4+Pj5bq7mamqiKqbmImrrKqcu2Rkm3XJu2Sbd2R2upu6zLqZZWZ7jruGa3V3V4jJhpiGd6uYhWfYu7p3i0ZrWGlIiX83nI9qN4tKN22ntkREV0Z9MzMzMzMzRzMzMzMzNDMzMzMzN0czMzMzrHdlZGVminhmZWZ4mndmZWaIrGZlVGV25rvMzdva9erq6+ra9drr2+vZ9drczcy7ZmdnflZnfWVnWYmGmJuXiYhmmVRWenlVnEZsZ3pHiY9HrZ9JOJtbSL2ot0REaFafQ0NDQ0NDWENDQ0NDQ0NDQ0NDWkZDQ0NDuriohYSEpsbG1NTUyMjJytXVxcbHurq6uot1mciplqjGuIaauneHl3WEqXW6yGhoeHd4XnuZfoWLW5mGd4iWhtTGt2ZoeGhnjjhuWFpJeY85n39dT71KNEyvx5hoeUhvMzMzMzMzRzMzMzMzNDMzMzMzNLo2MzMz1NTU1NTU1NTU1NTU1NbanHdmZWZnnNrWrax8emVljGZ2e4ysvMrZ2drLrNbV1cysVmd2bGd4a3VnV3Z2aGdmZsqbiVVWVlZWjUd8aWpaiY9Jnn9ZTr1aREl7l1lGV0aPREREREREWERERERERERERERERI9FREREVVZ4mpuammZmZXiLy+Tk5OXm5djYqmhW4+Tk1NbJybm4uLt3ZMvZvMvKZqqqyuTkVmh6Xmh4b3Z3aox1aHhmZ8mahlRWaYxVbFl+aWtHiq9Jjo9bOK9KR394plVVakaPQ0NDQ0NDWENDQ0NENUNDQ0NDRnxDQ0ND9ffcfK3c2ot3rvn26r6t3Onp6Pb39ff3zWdVm1Vn62VpemVlrWVUnXplzZ1lv2lURWhoa1d4enZWaYqIaWeIZ3tldlVEVkVmeVZ6aHlXiY5HrZ5HR51sRZ6Zh0REZkS+Q0NDQ0NDZ0NDQ0NDQ0NDQ0NDV1VDQ0NDdXZ3vNXV1NTVu4eFhYSFqcjX1NXXqoZ1ZYaHhqmryqu6lpiFhaemuaiW1bmZyKmId3mHbJiWb5aoi5zGt6i2l8i5lXWJialYjjddSVo5e284fH9sKp5cJE+expppimxvIyMjIyMjSCMjIyMkJCMjIyMjJLsmIyMjxcXFxcXE1dTWm4mamJu7y8q6mbvKxtXU15uMeJucyMWJysqpqZiJrKuIiqyKxdXJdnqYfldoaHV6v6qbiYl3q3yImFVV2IpVbDdsWGk2ZZ1bbG9pN4o5WIyYpkNEWEZcMjIyMjIyNjIyMzI0NDUyMjIyXkUyMjIy3Zx4drva9Oq7dnib3PX3vXZlVHV2rPf1zWVmdYrddt2adVRlzax2y9uIdXa86nitZavdnneaiXV3jey5ZohneJuIhnVVaFWHikZ7Z3lIh41Juo5ISr1aRnuHx0RVaEWfMzMzMzMzVzMzMzMzMzMzMzMzWlUzMzMzeYmJmsfH5sqbZWV2m3p5q+bl5djJuKqpjefZyemMytrZytflzFVmZmR49bxkjNhVZmd3bmqIfXWbWod1Z2Z1Zdi5hlRVZ2dWnUd8aGpYmp9Jr49LTc5bRG2YpmRFaEaPQ0NDQ0NDWENDQ0NDQ0NDQ0NDSGlDQ0NDZ2dWffn1959qU42/9fj6nlNUm/27V2hn9vPcdn37+X1lZWdWrZ5au5tWi3plZpvtZXdXameIi3ZnZ1hmeYpoaH9WemVWaHZlqmadeIpmmZxWvK5WVrpoVGdnalRViGecU1NTU1NTZ1NTU1NTVFNTU1NTamRTU1NT2ay8z3hmVGRmnIx6q3ucrWdmVWV3zsys+dvenXhUVVR23v37+vv+zmdkZVR3re7qeHd5WFVWZ2VVV4ubmYt7aHt3ZVRUZ3t5yVaqh5hmp7tXycxXR8mKRGdnVVREZVWrU1NTU1NTZlNTU1NTVFNTU1NTVkZEU1NTydfW2MbHx9fH19bYybq62cfHx8fH2Mm4aXt6ZcnK2NnXeGiMep2eebmc1pubeo2sVVZ6XVeaf6t5aWh2aIh3eKuKt2dVaURValhpVmpGh61KfX9YN65JRm6IlVNVaTSOMjIyMjIyRzIyMjIzNDIyMjIyNWsyMjIyh8rayrq6qMnJ2di5hrrLl6m52pmHmbyai2S827q62cnW2otkzYq5uKbJ5aeWqZjLZomXjWd6m6ZnWHaXyHmpZ0R0mVVVaGZUikdrV2hHZ484rI9aOX5MWZiXuzRESTOfMjIyMjIyRjIyMjIyMjMyMjIybGYyMjIyWnl4aImoyM+Ob+v36OjY2JxrV1tv+s+vVVVWVlVVV2eK9vXHh4SGhoaWnFau8/lXVVdYu1dpRbq3183GqXhXZunXxmVWW1hWjFd5Z4ZFhs17e4+YWKtZRWy8vGVEVlV8Q0NDQ0NDRkNDRENERENDQ0NDQ51EQ0NDVFVVZZvL9OjLd2RkVGRlZavK9ruKVVVU3Pb56vnp9Pf3+Pn3znZVeJu96a6LZlVmVmeZf1d5fHZoanhkd5l3nHp4q2Vmh2dmfVmOenpamZ9Zrn9HSZxLWYyIl1REWUaPQ0NDQ0NDWENDQ0NERUZDQ0NDXFVDQ0ND1dTU1dXV1tfX2KqZmpqpmoiKvOXl5tfWnGZWVmZlebyausrLmIhlVVVVVWfp5dbZeFZ4rVh8jXZ3WZl3aHmGZr6+iVdm5Z1VfEhZWHhHd59JrY9LOo1uNH+qqVRnd1mfMzMzMzMzRzMzMzMzMzMzMzMzNW01MzMzWGhoV1VUVFRUV4qImKutrqyZh4eIapiJmqiLjmhUVFRUVWhniYd3eVrYt7h7d3ZnaFRUVFRUVFRUVIhnv/b4vc/4/PtKepZ5VFRUVFRUVFRUVov4+Y9Wfu/724+mt7tUVFRUVFRUVFRUi9tUVFRUVFRUWs7cd1RUZnZ32/f29fX3nmhnZVVVVFRVZXmcvHh3Vs96+7xVnfpmd72sZZzu3v+vaZ3t/MplZmZmjFdnenlmWHhlZ2Zld5x3dlVFZlVWq1aKdplnmM5prJ5HSe1qVol2eVRUZ1WtVFRUVFRUZlRUVFRUVFRUVFRUaVVUVFRUvaqZqat5VJzOzs+uvc/evOvcaUNDQ1Z6mmaImsz6vJar2+r5ybm12eroeur629q6VWtVaWd3d4R2Zpend5eIeKqHhURmZnZUekaMaHlGhpxYin1lRaxHRmmGtkM0ZkVaQ0NDQ0NDVkNDQ0NERURDQ0NDRVhDQ0NDaFZWZ3hnZlVVVWVleKzM58y8eFZUVUVGm9fW1ubn5ejn2tl36Obk5+bl59jLzMy8eVd3r1l6fHZ4e5uXeHmGiMqXqGZneFd2imhrWHdXd59Inp9dSn5/R313l1RVe0avQ0NDQ0NDR0NDQ0NDQ0NDQ0NDSldDQ0NDaomsu2dVVXm66d29eazdu2iK+Nubavz9yYn6ab5ouout2/m8vGZleN6+ua2/y2eIVLusvFdVmWRpm6tqZYdlZXt2ZkREVVRUeFaap0Znx7pGqatWNdpGRFVlVlNEVkSJQ0NDQ0NDdkNDQ0NERENDQ0NDRFVDQ0NDVGZ4aFVUVFVlZmZVZHmc3q68+L2u3pt4zYx5nPW7ypr1zJms2/j06smnyai56vTqVWdnjWZ4ioV3WIimd4h2d8uYdVRlmWd2i1haZ4lXiY5HnJ9aOatsRoyWtlREZ0WvQ0NDQ0NDR0NDQ0NDQ0NDQ0NDWFVDQ0NDqpqc2ebm6Obn2ol2dqzL5tnZu+jo5surdb7mzq14VFZkZcqrdeh5ZVVmaFWaruncZXhnfVWKfHZmWZapd4hnaK2JhVRVaHdmnEZsaGpJm35Ivp9aOJxcR42Xp1RVZ1aPQ0NDQ0NDWENDQ0NDQ0NDQ0NDR1dDQ0ND7buYmcrK9/f32qqqdnZ1ipqKnGZlmsrL96uripmIqt3NiMn26oqJiZyZqXhndXj4hYmonmd4iHZ4eGeoh1ZlicuYdUNUdXhWnUePZ4dGhb19fW9WN6tbNVqrlUZFZlZ+MjIyMjIyNTMyMzIzNDMyMjIyM68zMjIyqdnKvMvZyOjazNrpudnLu8vZudq7q7vKyLq7m5qHhYeZqry52LmqiYiWloh4iZqqZWZ1XVh3a2RnSHZ0Z2ZkZdmodURFZlZWnUZ8aGlImZ43ro9JPN1ZNFyIlFZEVkWPMjIyMjIyVzIyMjIyMzIyMjIyNYwzMjIylai5mJWVh6uqloeHutjImqmZd4aKbXiHmLa3j3ulp5aZpqq6qt+pdnWGl2qWqZaaSDQ0NDS9TLe3ubl5alno1+f5iYiVlpW4MzMzMzMzM7iJqN02aNt/O1/fv8yFhUg0MzMzMzMzMziNuDQzMzMzMzMzNK2aTjQzj52qqJl8fKyqtsbF1dbWx8jW1dbV1Me41tTGyMXGmIafeafHnFlafElGqdTVt53HqJhrWTdomJdYarh7bZ8zMzNunbaXmIimSa1bWjNsakmXj0h+MzM0MzMznjVnend6bTM0M0UzMzM0rzMzMzMzMzMzMzNpSGY1i6m4mIdoinlWVGRlVVZnVlRUU1NTU3iKzLuLqlfs/f9mmlVWZnllWKqOaFVTmYr+aFSJvptr/c14RYiJqbedzb1maKpGhvtWeEVVmruYt1NTdmr8uWhTU1WKzIusuGVoU1NTU1VTVFNTd6uNVVNTU1OLU1NT+mlG19fHx8bGxrW1v09KVVZWVFRVSq/KtcfHdnWOeWd2mLfGtH9VVUdLa2pnZ7q117eIVkdGRkVGRleZxrR7dXR1d3aGuLTGeXdle2ZmZmlVRkdaeMa0tbW1tLW1treIfXc+Exi5dVc7KRQUXz+5tba2rayanhouExMTtLS1qlpWVldZbVhVVWd6a1hs3/f29ufXbmxEZVZYNVllm/irtcnW1qh6aGipmIpWp8iKRUZUVmSZl7X3W1jfhnuduLn3qXuVRkVVpUNYV1bnalZGfMafh6d9Rn7HWmdVQkJCQkJlRkNIVlhnemxFn+tCQkKnQkO/dVlLnXV0hbnaqHV1dYSUhJiuSylqyZWVjUpERlVVZHXKhXV0dHS1xpa6JcyJrGiKh55mR0lkileZZFr81vf9/75WeXdqiIZ1RUhDWWRZqmW7vFandrabndtEVlyHWKW/Q0RCQkOJ30NDNUpVWEl1+ag1Q0KMeYk15ufXtq6PODg6naiopba11trLiJmIiLrHlpZ5pbdsjajIprZ+vteYvJeWblVkZVhmtY9YybWoSVldV2Rb2Me3yth8jKfX2EYyN4Yzp0q4MjJHZpzIenV4jpt5WjMzt0oyMjM1JzU0MjMyMn6Win9me0c0MjIyMpwzSK7f35xqaFdXaEVEQ0NDQ0NDQ1p7elZWV3V1dZiFdXZWiotFZoh3RENHaphlZnyvds9o9/iN9Wh1doZFdotGeZh2ZWZ131aF+cf6acqLuXze3/ZrZ4ZoVnd2h5mqZmb5Q0RDQ0VGu3b3Z/dEQ0RpfHh2dnVlv65E2a2LdWRkiKvK2MqrineHhqvM3Ojah5i5qdfNi5q85slkd3V33Ofbvcrnm4eo5cu5ZVVHREdpZ7pWaGl3h42prJm4q4qHZmRmeDRFQ1c0M2l4faudeL81OTiNqbdWakRmMjMxMTI1NUVEWGhtMTExMTExX8pZMTExt2p4aHloZ1hZeru61di9nNfIq4qpt7i3rNu4uKupmbituavqb5u7a0jXpqecNcq2mJiX13eW1YWLyJuZmLdHjWw02Fl/RjTJ2KiXWXsyMjJqXKioqEatMjIyMjIyMtyNakhaMjIyMjIyMkhHNWsyMjIyMjIyMjJ+h7e4qKaZrbu4uLi3h5eXuLm8jm2LuIaGVnV7iZh4V3qoiGl1VsjLnlzJ5UgivszJpmtnuXmIeap5uWZspVTFmnqcvm8hq7dUeXaax4hoanl32Jp3ideoeSEhISEhe6jXOblcIyEhISEhJay5SsZ3RyEhISEhR3e3l7q8e0ZGWFtrXK/Nybm5y8naq6i4q7qom6v6y7uJmZqoqru8m1hErJjJ2aqZekZ72uiJuZp1toaZ2cu62EV8RER92EZDQ0NFrruJeppEQ0R5aqro66pEQ0NDRENDQ0WZREZGQ0NDQ0NDQ0NtR0dDQ0NDQ0NDQ0NYRkZVZVyP38rJxcW1taWmlZWVlaWlqn1sVmh5nIhonvr0ycWkt7W3lZSUhISGbFVnaGtoq+evlnZmdmmWqbzL9/jLtbScVEZLWzQzNDhce2dJVlc2e3q8WmrG2Z9JNUZXMzMzMzMzM0tHeH04MzMzNjh/96RXXEg0VUVFRmZmhXVmV5m82p2dycbHuKu7jGdmh3dom2m7eJhmdoipatnmyYy86Lh4eaaoNIfJ+vbHt0Y2nEyoSJuNmIp5mGl4iMhnNoh9MTJOybW8eMd2e0Y4MlWYrup3ibyYMTMxMTExjzKnVzGfbDExMTIyMoeaiEkzy5h2qOf4nkk1OK/O2LiodHR0d6eVdnd2emWHyU0mJSTKx8i9rDjNuWSaufyNqoZkm4ZkpVxDVtevNHZlaEVXrna5us53dnaripdUnDN1mDd2M+oyVWl3Ssp5x5imNVZKMjOIxjJIuTJ4MjPcSljYRVgyjHnPMjIyx7q9zr2ptpWXqJiInb26p7nNvZeVpaa3l4dlhXRnlcnL1tenyPXn2snKy6xZnHqWZ1dFRUZXZYd2pcamqtu4fn80NpnPabxoNjhZdmZ3aVZFhoeGmcszMjIyMjV9XVh+MkpdMjMlR2mGeGaWbTIyMjIyMjI1bTMyaGdnWLzt7vz626u8ipycr//7/ZuamYeI23dU7q2JZ1SJWFSbzpqpZ4d3y+mZh2hZfFdUzFhnV1RUVGlUVVVnZ4v6+r1nVGZUVFSaZ1ZUVFVUjZxUZY1UZ5uaVFRUVFR5VFRUVVRUVFRUelRUVFRUVaqJVFRUVFRUVFRUVFVXmmhneKu8+fn5+/z+vIiaalVVVFRVWHq4vJiJu/q5rVRUVFRVz96LVFRUuZuKh5aJVFR5v4uJ6Ih6jFZVVtx5VlebVFRUVFRUVFSMz1RUaq5bVZ+ZVP6XVP6NVFRUVFRUVFRYfFRUVFRUVFRVVFR4VFZUzWp5amd2dWV1dnZ3fY+/7M2tzMzKucrMu+uZV4m6iqmpmsvM6+ppefr6+praiXuq+kZGREREqkdERGh5u6itmI1F3ES+h4yYZ0REREREREREREREqsyLRERERERERMqaRERERERERERERERERIjJakREREREapd3uMjY6auZmZubntvJycnK/Pr7+769rIiYV1VVVVWt32mLrb16/p1VVVVVVc/+vrrdVVVVVVV6aFVValZVaGlVVVVVVVX6rNdVVVVVVVVVVVVVaVVVVVVVVVVVVVVYz59VVVVVVVVVVVVVnVVVVVVVVVVVVVVVqlVVnKuaqaiXlISEhIWFhoqtrZh3VUVFZmV2VWdnV3jHxtbWxafH9vfqnHprekdIvEo2fYxYWHpWudb31pTZq3uKj62vqKmaamt9MzV6r66IaszlpoZ2jGozMzMzM4qOWDM0WDMzMzMzWbj497eaMzMzMzMzMzV6Onwzu+n5yZl5aYtoZnh4h2dXRENDQ0NDe7m6+Jl87HhVippVl0ZFd7mIdmtXZ2lVabn/m6WZaEZ6q0VmNGW8y6ioqnmXimqZyIyZRkd6eneGdkNEqYiLmbd3iKf9WUP/mq9ZQ0NDQ0NDQ0NDRJlGeUNDQ89DQ0ND/4tpZmZmZmZmZ3ma/8/vemZmZ4qc397Lmnl5ZmZmZmZmZmj+/GZmZmZmZmZmZor97XdmZmZmZmZmZmZ53mZmZmZmZmZmZmb/7mZmZmZmZmZmZmZnZ2ZmZmZmZmZmZmev/2ZmZmZmZmZmZmaaZmZmZmZmZmZmZmbPemZmiIaGdJ3M5du+zffZr+vsjaemlJaIrMm7VUdGZ5t7dsl2rPaUlvvJyIpFRFZTU0V7aUNVdlZneIarrMnt3OzKa+uJd2V5RUNoVmVURFNUVWWGlXrJq4e4rDMzRIpoR1ZWMzIyMkhFU1NWSjo5fTQxXGxYaY6PNTEyRGV2hYWEhWRjY3R1lre3xLandmRkVkZFqZmKjJuIhnh6nZy5yNPT09WvijV/ysfJr6uajnmmxNPTxIy3X7vIubd4iJeIeXrGOWeaPVdJp3Z1hsSLVqcTFXem1MbEyDZvJThNfj1FKRInSWUsKRImFIeoEyV7bW8nVFRUeaaltdbm9ruqhnV0hISWeEZEVUVVaYiWZoa2lXSmVWSFh6/HqYlXiViLurer2Wd8jbm2lXSZyaiJn7pZOWhHqVdaOklqWVyZyIpv18ed9shth9gjXzhd2PXzl49KIiJaSkxrN0RValsiIyIifyIi5efjdiQiaW6Pvq6NjaimxsXF1tbXj2ppa42Mao+Paop7V2p3eYelxtXl5OXZiqqNma3LxqaFRERmdnloRFt4uMrY5a5FREVI1+V21aZbREREV0ZZRER5alqcvURERERERNZ2xYVEREREVmZGRERrvYp4RERERERERFvnt3ZEhpenpra2tbW1tbW2tqa3p5eYeIiImKenl6e3mKaltba1tba1tbWpan26jEhIemqomaqGpbW1taWlprW4nI9fJCR9un47bjufJX95p7WlppaWtpaeJyQkJCScdzY4biQkJCQkJY+sapqrPSUkJCQkJCQkmG1rJCQk5MiqyNXFttbWjXyr1beJq1tJjb3cfqzZryQ0N528jZpYjUq3x7upnEuZp7e4qNWeRGR4VUSZl2l1doaGibaci6eY1bibuce/hok0aFVoMzIyMkiHlZozR6iorDQzyac2Sjerp4oyMjIyMjIySFgyMoozMjIyMkibeldFRFZnd5mamqiYiYqLm2hXV729V4u9RENDRImJRVaaV61XmqicjM1penp7V4xXikNDQ2aYRLrruWmdQ0NDRPepzHhnec3IQ0NDQ0NEQ9r4+PmsQ0NDQ0PY6umrrJ27Q0NDQ0NDQ0at6ptEQ0NDQ0NE187vq9hEapuMncfExJqZhIaZqrm5ube4ubmtf32NV2hniHiJhoV5m8TGjHpLamh3hYV3iId3n6akmaalw8LCwouUX7ezp5Vod4aIeGq0brYpCFc6lmRndsOLxma1XFaVw7TDuSWITQAApmwzCQBeeFQKLASoa3emA106SpsCpKW1xZ59fre3iGdpfau7xMPEtqWWlaamh6aHiXl7ZX7CpZW4a3q1w5e0s7lUaGetfVayq5aYt1dlajiKWKTDWEm2qIe0WBuMfAN6SYl9qnl9SzyJKhe4W6gcxGiGA3l+ABSLw5k7XAJYp8OWtwCHo5eMBp0AAC2lW1qKt7rJucq9W5y4uqqYk5OUd1lpi6yaaHh2mbWslpZ2h2enl6vFp5lXh2iYt7SbSUtrpamElXW6trh9mJ8mKFhGqWZYOEeKfrfUSWyP18V9zMUoJMeZljVtttTSlo82ISEhJTm4bDNWaSohISFuSyQh0tbDZSMhnlxHVVVVVUpez6imiXh3doaGdmZmeIeKelVUVFRUVFRVf7mJmbe4t6i1mIhXVol5VVRUVFRUVFRUb5jX/fz59//MyJeGm46qVFRUVFRUVFRUr+f4639IVmupp7uJ23lYVFRUVFRUVFRUyfdVVFRUVFRVva3Ma2hViJWWl6e2xdXVxre4tramqKinxba3yaeWebbGx+TEt0xJSVtOr5/X1rSXmVZXVWiHSMZ6SWzJRnhleXhlZTN/yLZYpZdneVQjRnyZKFU4iJiXSZa2d0kytqZlesemWI2bJRF0OYYRERMTOUmMb26P1UsVf2WMWDYjZmZmZmZmZniK///fZmZmZmZmaP//z3hoZmZmZmZmZmZo/3pmZmZmZmZmZmb//mhmZmZmZmZmZmZm/2ZmZmZmZmZmZmaMvmZmZmZmZmZmZmZm/mZmZmZmZmZmZmbvemZmZmZmZmZmZmZm32ZmZmZmZmZmZmaN/2ZmZmZmZmZmZmZnaaubZ2ZmZmd6vv//q3hnZmZmZmZmZmZmimhmZmZmZmZmZmfOimZmZmZmZmZmZmZm/2ZmZmZmZmZmZtz7/f9mZmZmZmZmZmZm/2ZmZmZmZmZmZv9nnP9mZmZmZmZmZmZmz2ZmZmZmZmZmZmd5/3lmZWVlZWVlZWVlaHmKzNz8/vzczHl5ZmVlZWVlZWVlZWVlaJr+j2ZlZWVn7+tpZmVl/2VlZWVlZWVlWKtoZWVlZWVlZv9pao//ZmVlZWVlZWVlV61lZWVlZWVlZv+np8j3ZWVlZWVlZWVli2dlZWVlZWVlZZuYr/5oZWVlZWVlZWdoer/fnHlmZWZnav//eldmZXtlZWVlZWVmis9lZWVlZWZpZWWuamZl2o1lZWVlZWVleWdlZWVlZWX/vMytnL/K/2VlZWVlZWVleGVlZWVlZWVl99ypitzMZWVlZWVlZWVlaWVlZWVlZWVlZf1med38w8PDw8S3um5ad3eHq7u4x6mpqYd5u8PDw7WoiniZl5mmpaW1xMPDw7l6WHpYfbvDWm6Pmns1dZaXRotZZYqbq6nE05ueqHl6Whc4aIlkalpIWCSKfZ03XZ5oqcbGxrebEhISEmskEhISR0gnExISEhJ5fVysiEwne2hmZWZoi9vZvf37/8+NaY3P//r8zNrdZWVlZWVlZWXMrvpmZWVlZWVlZWb6zM9lZWVlZWVlZWa//M9lZWVlZWVlZWW/3GdlZWVlZWVlZWdlmmV5ZWVlZWVlZWVl3GVlZWVlZWVlZWVlimVlZWVlZWVlZWVl62VlZWVlZWVlZWVlZVdoeXmKaWdnWGZlZWVlZmVlZWVlZWVlZles/mhmZWau3WhmZWhq2sj9/89lZWVlZohqZWVlZWVlz5uKi3ip/2plZWVlZWVlV+xlZWVlZWVleq9334fqZWVlZWVlZWVlqnplZWVlZWVlZf9lmPy/Z5e2VonL7Yx3ZmdnmamnqHiIuPv7fP7tqKpmc2Nkvr9ZR4+MeWSEae2oqoi7+ZiJlsu4yZs1iXVlNafLSYuKrIlWZpyZvZxaZ3hHl2pmWDVFRpjNSkJDQkWsmWRng2RZQ0JCQopEQkJCREVFmUJCQkJDQ0JD26hWdXV1ZXV1dXV1dXV1dYaXppWVlYWFdXV1V2V3mndomXdmZXV2lqa2pra1p5WV2+3vn1nKu/+tmumqTKh2mJepu5aWtqZ1deuPa0g1Jp3YnWts+9runyc1NDjPZ3V1ZXb+NDQ0NDRJNDQ0NJxKNDQ0NDQ2zTdobL43x7a3t6amp7mrjZx6r97r+fvfv4mYmLrIv1VVVVVXvMuqm+za+mxVVVVa/fd6l8inVVVVVVVVWGpWe1aNbFVVVVVVVZ/ul8daVVVVVVVVVVVVnVVVVVVVVVVVVVXnmMlVVVVVVVVVVVVVnVVVVVVVVVVVVVXvl45VZWVlZWVlZWVlZVZWV1lqa42aeFdnZWVljM2quIplZWVlZljfnmVlZWbPv4toZ1ZnvPr5+PnPZWVlVqxlZWVlZWVlrKq7qMe3/mdlZWVpz2VlV2dlZWVlZWVlZa6Kp6b6ZWVlZWVlZWVlnWVlZWVlZWVlZWXOmPiPZWVlZWVlZWmby+79/f7+q2uM31lmZWVlZWVlZWVlZWVmZ8tYeGb/jt2q7WZlZWVla/+Zm2ZlZWVlZ7tlZZp8ZWVlZWVlZWVleWVlZWVlZWVleGVlZWVmapyceGVlZWXPZWVlZWVlZWVl72VlZWVlZWVlzrxnZr1XaFZXV0ZHe7ennv78ro17enuMe1lqe2loiGZpVVZ3d1fI+Wu3ie/va9y55uyXnniXVFRUVFRVVVS8Vdz6dsppvraJiZl4h2ZGVFRUVFRUVFT+Vd2r/JtXVFRUZqeWfHpUVFRUVFRUVFRUvFSuVFRUVFRUVGWXd3hVd3l6aWloaGhoir/O3czc/f7+/PrqrKurZWVlZWVlZVVorNxoZWVlZWVmnPz9rZpoZWVlZWVlZWVXrHplZWVlZWVlZY3/nIdlZWVlZWVlZWVlimVlZWVlZWVlZVb/3XxlZWVlZWVlZWVl7WVlZWVlZWVlZWX/y2hlVlVVVVVWZ1dXh4eHzPzrnM3M+ryMq8+s31VVVVVVVVV4V2bs+rz+3+7+eq+8d1VVVlVVVVVVVVVVV62sVVVVV1VVVa68ZlVVVVVVVVVVVVVVZ+lWVVVVVZn6/fzdaLlXratVVVVVVVVVhutVVVVWjFVVVVV7VlVWys6/n7/NyaiavPn49/f3+vfn5+vdnaanVVVVVVVVfKx9j6/7alVVVVVVV+/4m7hZVVVVVVVVaVVXeWpWa1VVVVVVVVX3rL9VVVVVVVVVVVVWmVZVVVVVVVVVVVWfvVVVVVVVVVVVVVVVnVVVVVVVVVVVVVVVqlVVrYuKrPzo6Li5q9v6/f7vz9/v7/v9nLjHVVVVVVVVVXmpqsmaVVVVVVVVVWvZyrh8VVVVVVVVe7p7q8qsz1VVVVVVVVWPrFdVVVVVVVVVVVVViVVVVVVVVVVVVVVVvFVVVVVVVVVVVVVVilVVVVVVVVVVVVVVzFVVZ1ZmZWZnaJmomd7/69ytiq3d7P//m6mqZWVlZWVWzez9+//uZmVlZWVlZVf9m3llZWVlZWVli2Vmmlhm/2VlZWVlZWW+q2VlZWVlZWVlZWVlm2VlZWVlZWVlZWVlvGVlZWVlZWVlZWVl72VlZWVlZWVlZWVlu2VlZ2ZmZWVmZmh53P//rr+LZmZnef3+vWl4ZWVlZWVlZWV67J5lZWVlZWVlaJv9imZlZ2VlZWVlZWVl/c9lZWVlZWVlZav8/mm8ZWVlZWVlZWVl/mVlZWVlZWVlZ7vfvWdlZWVlZWVlZWVl/WVlZWVlZWVlZc79+5plu8nZ3Mq5q9/8/Y9rZWVlZWVlZWyf/PztaGVlZWVlZq+v+2hlZWVlZWVlZWVp+t3/ZWVlZWVlZo2dr75lZWVlZWVlZWVl+OllZWVlZWVlZWZmzmVlZWVlZWVlZWVl959lZWVlZWVlZWVlrWVlZWVlZWVlZWVl/GVl/Pvdzvv42mp4WHqZdWVniWdVWJmIV1h5V0ZqWIilrMtDVqas+Kp5R1j82od2l/msR7zf7UVDaO5DV5tXd2WojZhmZ+l1qMiGZ3lDQ2hDQ8lDaUV5vJlnV0R9VK9kv1SdVkNDQ0NDQ0RDrUPNQ0NDQ0NDV1abRHR2jLzJrEZFRFZ5271rRq7d6urbyqqraHd4h4WIemfLyVm7+5pmrVbKqcea6tiad3aMe0VEREhpr0arjmn9WUaIaJmJmvrImXeJRkJCQkJWdDbKZ4lZy2lCQkJEiaj2ZWpqQkJCQkJCZ0ZsWnhYQkJCQkJCQnj2iFl3ZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWb/aWiKZWVlZWVmZ3ebqoloZWVlZWVlfp75+7lmZWVlZWZ422hmZnu/e2VlZWbfZpvZq5h4ZWVlZXjsZWVlZWVm/3lmz62KZYrPu4llZWVlZc1mZWVlZWVlZc9re2VlZmZmZmZmZnmM/v3/amZmZnuvz+//73loZmZmZmZmZmZp/mtmZmZmZmZmZmf9rq1mZmZmZmZmZmZm/mZmZmZmZmZmZmn8u5tmZmZmZmZmZmZm/mZmZmZmZmZmZr/qyJ9mZmZmZmZmZmZm/mZmZmZmZmZmZmbuymlmZmZmZmZmZmZmZmZmea29nb6+nGZmZmZmZmd5fIx4ZmZmZmadZmZmZmZmZmd5ZmZmaK6ZZ4mcr2ZmZnlmZmZmZmZmZmacZmZm//9mZmbP//9nZqxmZmZmZmZmZmZmZmavaGZmZmZmZmh4/2dmZmZmZmZmZmZmaP54yMu9n77MuaeXrdnX6u3Pn9/89/f5v7i3VVVVVVVVVXyXvMdqVVVVVVVVVb/3rbefVVVVVVVVVYyrj+tZVVVVVVVVVVX2nMhVVVVVVVVVVVVVilVVVVVVVVVVVVX5m75VVVVVVVVVVVVVn1VVVVVVVVVVVVV9mlVVm2hnZmdoZ2mL73toZmZmZmZmZ73u/ruqZmZmZmZmZmZo72ZmZmZmZmZmZmZo//6fZmZmZmZmZmZm/2ZmZmZmZmZmZmZm/P5mZmZmZmZmZmZmvWZmZmZmZmZmZmZm//1mZmZmZmZmZmZmvWZmZmZmZmZmZmZmz69mZmZmZmZmZmZmZmZmZmZmeGdmZmZmZmZmaP//r9//fmZmZmZ4rWZmZmZmaL5mZmZmvGdmZmZmrP9mZmZ4ZmZmZmZmZmaKZmaeZ2ZmZmZmZov9ZnlmZmZmZmZmZmZmZmf/ZmZmZmZmZmZmv4lmZmZmZmZmZmZmZtxmZmZmZmZmZmZmZ1l6///fnN///2lYZmZmZmZmZmZmZmZmZ91oZmZmZmZmZs+tiWbLZmZmZmZmZmZmWN9mZmZmZmZmZmb/72pmZmZmZmZmZmZmWGZmZmZmZmZmZmb/Z2ZmZmZmZmZmZmZmqmZmZmZmZmZmZmbtiGZmvXmHp9nJiXuMnJy93N3NnM3b2svL23p6VFRVZph23Lxrjp3P2ai8VVRUVFfqykZUVFRUVFRU3Oylq8uYVVVUVFRUVFSqy1RUVFRUVFRUd/yKqf6qVFRUVFRUVFRVq1RUVFRUVFRUVHiG6om/VFRUVFRUVFRpqFRUZmZmZmZmZnl6z3x6ZmZmZmZmZnqN33poaP9mZmZmZmZo72ZmZmZmZmZmZmZnvmdm/2ZmZmZmZmZm72ZmZmZmZmZmZopmz2f/ZmZmZmZmZmZm32ZmZmZmZmZmZmb7rfj5ZmZmZmZmZmZm72ZmZmZmZmZmZmZmvvxmZmVlZWVlZmhorP//fWhmZmd6nv//nGhoZmVlZWVlZWVnibxlZWVlZWVmimfveVdniHllZWVlZWVleWllZWVlZWVojP/5+t/faWVlZWVlZWVlaGVlZWVlZWVl7f3/iuiKZWVlZWVlZWVlemVlZWVlZWVlZfv3+f6oWod5mIdam2qaa5ubeqqZm3uJmpmbeZubR2qci2dZWXmZqnubmpubmXt6iJqsm1uHu5Z2ZXj3q4iKx8iFlWU0R0XXyWhWmjKpMjIyMjKZydyZqfzI58mc6c0yMjeaMvuFMjIyMjKo+lZFMkQzMjIy+DIyMjKZ2ZYymburiJqrqarMi2p87t7r2dv+/318zXh5VlVVVWft3auJZ3mr+99WVVVWmqi/u3l4VVVVVVVVePtmVnj9VlVVVVVVVVXsWnhVVVVVVVVVVZlVVZpVVVVVVVVVVVWsd1VVVVVVVVVVVVWbaPxVVVVVVVVVVVVVmFVVvNzaybyenZyKqbucm77d+fzfr3Z1hpWGxcbpaX3KnY5YV1mumnxazMe2xuiLhrrGRURERFZXi1lERERmykZERERERtjtlsXcRERERERERdp6q2iqRERERERERET1l75ERERERERERKtFRUV9RERERERERERtl0RE/v/vr+////r7nmZmZmZmZmZmZmZmjfz6ZmZmZmZmZmjszmZmZmZmZmZmZmZmnfp6ZmZmZmZmZmasr7xmZmZmZmZmZmZmrv9mZmZmZmZmZmZmu2ZmZmZmZmZmZmZmz2ZmZmZmZmZmZmZm3WZmZmZmZmZmZmZm/mZmuLe3x8i5q4mL3q276ff3/Pn35/f4z5iXVVVVVVVru92c3NvLfVVVVVVVVY/2v6iPVVVVVVV7an5VVVbNWFVVVVVVVVXvrp9VVVVVVVVVVZ1VVXhWVVVVVVVVVVVVrlVVVVVVVVVVVVhoZ99VVVVVVVVVVVVVvFVVqKeouKapzr+dd1dGRERERWZ1aLzNns7aqlhERERERFmYt+x+REREREWM2URERFmMilVnl7iYZnuox2ZFmfy9/drKvFlFZbumRraZWEZquO1ZWUREzptY30RE+5nIm0RYREREREREREREZ8qn2kRERERERERqilXs1tbW1ufYyY1ca2lpirq5nImIh4p9vtbWVldom7fG1dmtbGmf2/frfmxanYZ8i0dFRERERWa/rsjXydjn2EdERERERGmKRERERERERERon8qujcjJRERERERERESWREREREREREREV1e6usxEREREREREREWKr0REZmZmZmZmZmdnic3eemhnZmd6n///q4p5ZmZmZmZmZmZnnK1mZmZmZmZmZmj/nWlmZmZmZmZmZmZnzGdmZmZmZmZmZnzKiL1nZmZmZmZmZmZmzGZmZmZmZmZmZsz+ua9mZmZmZmZmZmZm/2ZmZmZmZmZmZmjvqIlmvZ18aoydv6+vrr2s2/j5/Pj3+q+fq7i4VVVVVWmKhpa26PbLWFVVVVVVVt++u81VVVVVVVW5t1hWeWdVi41VVVVVVVXoyFZVVVVVVVVVqlhVilVVVVVVVVVVVVW/2FVVVVVVVVVVVVZVmlVVVVVVVVVVVVVW3FVVZmVlZWVlZmh5mv7/v4xpZmh8r//+iXhoZWVlZWVlZWVom/9mZWVlZWVlZmn/rGhlZWVlZWVlZWVmi6xlZWVlZWVlZXn/i6x5ZWVlZWVlZWVliWZlZWVlZWVlZXn7m3i8ZWVlZWVlZWVliWVlZWVlZWVlZd/8mKxmZmZmZmZmZmdonf/PZ2ZmZmZmef//vHloZmZmZmZmZmZnro1mZmZmZmZmZmb/u2dmZmZmZmZmZmZmrWZmZmZmZmZmZv/+zPr/ZmZmZmZmZmZmjGZmZmZmZmZmZmZ8/GhmZmZmZmZmZmZmnGZmZmZmZmZmZmZo+mZmeqra/fvs21hHV6mpV1Z46bm5aKmoynhGmb6pyXh4qcr/y0VIm1bLiXhDQ0NWmYlWikRDVUREQ1Zm/UNDqkSazURDQ0NDRFhGQ51GQ1hDaUNEmURDQ91DqVaKqndGeLruikNDQ0NEmkNDqZlDQ0N6rb26e4i7rbpWZmZmZmZmZmd4/f//ZmZmZmZmZs///mhmZmZmZmZmZmaK/+9mZmZmZmZmZmZ6/2ZmZmZmZmZmZmZo/6z8ZmZmZmZmZmZm/2ZmZmZmZmZmZme8rcy8ZmZmZmZmZmZm/2ZmZmZmZmZmZmaLqmiaZmZmZmZmZmZm72Zm/frq29vr6//vbGVlZWVlZWVlZWVlZmyf6c9nZmZmfd7N32ZlZWVlZWVlZWVlZZ/6ZmVlZWVlZWWc/v9lZWVlZWVlZWVlZf35ZWVlZWWHmmZ6eWVlZWVlZWVlZWVlZvtrZWVlZWVoiIh5imZlZWVlZWVlZWVlZ/plZmZmZmZnZ2h53v/fZ2ZmZmZmZ9///4p5ZmZmZmZmZmZ5/2tmZmZmZmZmZma//2dmZmZmZmZmZmZo/2ZmZmZmZmZmZmZnvWZmZmZmZmZmZmZm/2ZmZmZmZmZmZmZmnGZmZmZmZmZmZmZm/2ZmZmZmZmZmZmZm7WZm/XlWVlZWVlRUVWdnjP/uaru7mLu6ukqLy9t5RVhGue/eilVUVoic/VZUVFRUVJlaulXbVlRUVDaIvWb9VVS6urtpVVRUVJm9VctUVFRUVIpV/VRUV+1pR4rsV5vdylaId1RUVFRUVFRXeFRUVFRUVFRWu2rcu2ab3dzb6tvd3v3/e2ZmZmZmZmZmZmZmav//amZmZmZmZ+/9jmZmZmZmZmZmZmZmfPz+ZmZmZmZmZma5znlmZmZmZmZmZmZmn+tmZmZmZmZmZmbLa3pmZmZmZmZmZmZm345mZmZmZmZmZmZqjWZmZmZmZmZmZmZm/2Zmap/f///v32lnZmZmZmZmZmZmZmZmZmZm6tn639/f2bz9aGZmZmZmZmZmZmZmZmbf+mdmZmZmZmar/e+NZmZmZmZmZmZmZmfqZmZmZmZmZr5oq2ZmZmZmZmZmZmZmZv/5ZmZmZmZmZmZmZ2ZmZmZmZmZmZmZmZvhmZWVlZWVlZWVlZWZmV2doaGloZmVlZWVlrp/7/69lZWVlZmj/fGZmZo3/enpnZ2is/P9mZWVlZWVlZ+9lZWVlZWVm/GuMmJiXfmVlZWVlZWVlZ2ZlZWVlZWVl//6dh5j4ZWVlZWVlZWVlm2VlZWVlZWVlZX1livhm28yLWM3cq6mIzs+9+d2dzv37/L6cmcjHVVVVVVVnaNvNr/+9VlVVVVVVVWzfmstVVVVVVVVVVVVVu1VWVVVVVVVVVVX8qqxVVVVVVVVVVVVVvFVVVVVVVVVVVVXvulVVVVVVVVVVVVVVvVVVVVVVVVVVVVVpuVVVZmVlZWVlZmdnee7/fGhnZmdpjL2NfHppZmVlZWVlZWVnia1lZWVlZWVmeIv/inh4rGVlZWVlZWVmimdlZWVlZWVmu//7+P25ZWVlZWVlZWVlvWVlZWVlZWVlv/3amu//ZWVlZWVlZWVl/2VlZWVlZWVlZay3uWllZWVlZWVlZWh5rf//emdmZmdpfP/+m2dmZWVlZWVlZWVmi3xlZWVlZWVmZ3v8qWlmZWVlZWVlZWVlnGZlZWVlZWVlZu3Z+e5mZWVlZWVlZWVl7mVlZWVlZWVlrv/418+vZWVlZWVlZWVl/2VlZWVlZWVlZZ7s/v9lZmZmZmZmZmhp3v//e2dmZmZofP//zXloZmZmZmZmZmZnnN9mZmZmZmZmZmb/rWdmZmZmZmZmZmZmimhmZmZmZmZmZmZ8jWZmZmZmZmZmZmZmvmZmZmZmZmZmZmZm7WZmZmZmZmZmZmZm/2ZmZmZmZmZmZmZm+2ZmZmZmZmZmZq7f7v3+jWhmZmZofP///657ZmZmZmZmZt6c/v//ZmZmZmZmZmbv72ZmZmZmZmZmZmZmimdmZmZmZmZmZmZm3WZmZmZmZmZmZmZmmmZmZmZmZmZmZmZmvWZmZmZmZmZmZmZmrWZmZmZmZmZmZmZmrmZm2ci32MmbaVRVaHl5zM7u/+vMfWl5aHqbq4fZqqiKrVRURWhpRFRUVGjKettWZlZ5yvb8eldUV1RURZlUVFRUVLuZfX14ibqJ7NmLVFRUVFRURVdUVFRUVFWpn33tvoj3i1RUVFRUVFRUWVRUVFRUVFRUeX7ZyfiJZmZmZmZmZmmM/v/fZ2ZmZmZmZ+///3pnuv6MZmZmZmZn/Z9mZmZmZmZmZmav32aJuXn7/mZmZmZm/mZmZmZmZmZmZmZmeYnLZmZmZmZmZmZmvmZmZmZmZmZmZmZmmmZmZmZmZmZmZmZm/2ZmZmZmZmZmZmZmu2ZmZWVlZWVlZnqdz///e2hmZmZojf//zotpZWVlZWVlZWVpzt9lZWVlZWVlZWf/qmhlZWVlZWVlZWVmvWZlZWVlZWVlZvvquctoZWVlZWVlZWVlvGVlZWVlZWVlZe3NyfuLZWVlZWVlZWVlvGVlZWVlZWVlZe+6qP5lvd/+7+3cvWlXVVVVVVVVVVVVVVVVVVVoimhVVVV4+2lVVVVVVVVVVVVVVVVVVVX/elVVVVWpiJxVVVWI/Xh4aK5VVVVVVVX9VVVV/bu6alVVVWe7mnmaz/6YeJtVVVXsVWf+2adWVVVVVsxVVVWvVVaLmvrsmpmIZmZmZmZmZmho//+eZmZmZmZmZpzeu2hoZmZmZmZmZmZn72pmZmZmZmZmZma//2hmZmZmZmZmZmZm3mZmZmZmZmZmZmac72dmZmZmZmZmZmZm3WZmZmZmZmZmZmiK//9mZmZmZmZmZmZm/mZmZmZmZmZmZmb//6tmv3xnZmdqnv/9+t+fZmZmZmZmZnue/fz+ZmZmZmZmZmbP7I1mZmZmZmZmZmZm/v9mZmZmZmZmZmapq7lmZmZmZmZmZmZm/59mZmZmZmZmZmZn/WZmZmZmZmZmZmZm/2ZmZmZmZmZmZmZm/WZmZmZmZmZmZmZm72ZmVVVVVVVVVVVVVmqMn31aWI3P3pyaiWhWVVVVVlZVVVVVet9XVVVVVVVVaLubqHhnu7nJvFVVVVVVVmlVVVX46N2o2sqcmL7c2fhWVVVVVVVVVlVVVVVVjfnNulftZ92471VVVVVVVVVVi1VVVVVVVVXf+VZVVc/4Z2ZmZmZmZnhoze7/nGdmZml8////zbysZmZmZmZmZmZXvHtmZmZmZmZmZt//62dmZmZmZmZmZmZm7WZmZmZmZmZmZmbPzWdmZmZmZmZmZmZm/2ZmZmZmZmZmZmZ67GZmZmZmZmZmZmZm/2ZmZmZmZmZmZmZm/2Zm/f79zpubZ2VlZVZXeImau5l4Z2ZlaL3dZWa//P9XVmVlZmfcnWVlZWV821hoZ2Vl+mZlZWdlZWVlVqtWZWVlZWVlmoplZWbfZ2VlZWVlZWVlV5xlZWVlZWVlZv+9vLz7ZWVlZWVlZWVlZ2ZlZWVlZWVlZf7Prf1pVFVVZlZWRlt9vMa2trbGxra2t7ipjUlGiJmbn5uHdlVbuLiNysbWycXXmpanbmlpRUeHelc2foZJqanW1ujW1ce6xWt3SmqpRzNGMzOreK1mmcbbxb1MM0vMt3p6S0fOMjIyMjIyMlx3pr2OMjIyMjIyM24zbzI1qqqquKq6yMbW1sbGxsbGx8fHxtbW1sfIm3h4eYmYuLfG1cZMRUREREVIr7q9r12Oqp+PXX+aeqnHxkpERERERERERa/Gurl6WEVERERERouoyEREREREREREREe6a2uNRUREREREREV5zUREREREREREREVuSkeeVlVUVGVVZYR0aEqM6cqqiGh5e+7ORzREVVdoeVjKqbzqdVXPhVR3iHdVR91n3Hw1loVFzIlXeGRWZlSOhGZUVkS8i1esuc1mZfn7drxV71JXZVLNVqy+imZ2NUON+WmX+Fd1aVdUUlJTVVbNelJ6q1JSUlSK/VJ6h4h4VVdndXeKyZuu3ez76+7fqpeXl5iZi7mreWesZ4u7qcnXv0ZDQ0S+mllDQ0NDd4qKeHWZebrFuFeb9WiLQ4yquqpFQ9/KRLmqh4Z0ZIVU97moRp78Q0NEmkNDQ1ZGRzRHV4lDQ0RoRXhqvWtDQ0NDQ0NDQ0PP';
  let decodedRotateCatalogCache = null;

  function zNormalizePolarArray(arr) {
    let sum = 0, sq = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    const mean = sum / arr.length;
    for (let i = 0; i < arr.length; i++) {
      const d = arr[i] - mean;
      sq += d * d;
    }
    const std = Math.max(1e-4, Math.sqrt(sq / arr.length));
    const out = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) out[i] = (arr[i] - mean) / std;
    return out;
  }

  function getDecodedRotateCatalog() {
    if (decodedRotateCatalogCache) return decodedRotateCatalogCache;
    const BINS = 5 * 24;
    let rawBytes = null;
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
      rawBytes = Buffer.from(ROTATE_ICON_POLAR_B64, 'base64');
    } else if (typeof atob === 'function') {
      const bin = atob(ROTATE_ICON_POLAR_B64);
      rawBytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) rawBytes[i] = bin.charCodeAt(i);
    }
    if (!rawBytes || rawBytes.length < BINS) return [];
    const count = Math.floor(rawBytes.length / BINS);
    const list = new Array(count);
    for (let c = 0; c < count; c++) {
      const offset = c * BINS;
      const lumRaw = new Float32Array(BINS);
      const gradRaw = new Float32Array(BINS);
      for (let i = 0; i < BINS; i++) {
        const byte = rawBytes[offset + i];
        lumRaw[i] = (((byte >> 4) & 0x0f) / 15) * 4.4 - 2.2;
        gradRaw[i] = ((byte & 0x0f) / 15) * 4.4 - 2.2;
      }
      list[c] = {
        lum: zNormalizePolarArray(lumRaw),
        grad: zNormalizePolarArray(gradRaw)
      };
    }
    decodedRotateCatalogCache = list;
    return list;
  }

  function extractDialCenteredPolar(dialImg, cx, cy, maxRadius) {
    const NR = 5, NA = 24;
    const w = dialImg.width, h = dialImg.height, data = dialImg.data;
    const R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const k = i * 4;
      R[i] = data[k]; G[i] = data[k + 1]; B[i] = data[k + 2];
    }
    for (let pass = 0; pass < 2; pass++) {
      const nR = new Float32Array(R), nG = new Float32Array(G), nB = new Float32Array(B);
      for (let y = 2; y < h - 2; y++) {
        for (let x = 2; x < w - 2; x++) {
          const p = y * w + x;
          const nb = [p - 1, p + 1, p - w, p + w, p - w - 1, p - w + 1, p + w - 1, p + w + 1];
          let sR = 0, sG = 0, sB = 0;
          for (const q of nb) { sR += R[q]; sG += G[q]; sB += B[q]; }
          sR /= 8; sG /= 8; sB /= 8;
          if ((R[p] - sR) + (G[p] - sG) + (B[p] - sB) > 42) {
            nR[p] = sR; nG[p] = sG; nB[p] = sB;
          }
        }
      }
      R.set(nR); G.set(nG); B.set(nB);
    }
    for (const rad of [3, 4, 3]) {
      const nR = new Float32Array(R), nG = new Float32Array(G), nB = new Float32Array(B);
      for (let y = rad; y < h - rad; y++) {
        for (let x = rad; x < w - rad; x++) {
          const p = y * w + x;
          const dirs = [[p - rad, p + rad], [p - rad * w, p + rad * w], [p - rad * w - rad, p + rad * w + rad], [p - rad * w + rad, p + rad * w - rad]];
          let scrib = 0, sR = 0, sG = 0, sB = 0;
          for (const [p1, p2] of dirs) {
            if (Math.abs(R[p1] - R[p2]) + Math.abs(G[p1] - G[p2]) + Math.abs(B[p1] - B[p2]) >= 24) continue;
            const mR = (R[p1] + R[p2]) * 0.5, mG = (G[p1] + G[p2]) * 0.5, mB = (B[p1] + B[p2]) * 0.5;
            const dR = R[p] - mR, dG = G[p] - mG, dB = B[p] - mB;
            if (dR > 8 && dG > 8 && dB > 8 && dR < 90 && (Math.max(dR, dG, dB) - Math.min(dR, dG, dB)) <= 18) {
              scrib++; sR += mR; sG += mG; sB += mB;
            }
          }
          if (scrib >= 1) { nR[p] = sR / scrib; nG[p] = sG / scrib; nB[p] = sB / scrib; }
        }
      }
      R.set(nR); G.set(nG); B.set(nB);
    }
    const grad = new Float32Array(w * h);
    const lum = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        lum[p] = 0.299 * R[p] + 0.587 * G[p] + 0.114 * B[p];
        grad[p] = Math.abs(R[p + 1] - R[p - 1]) + Math.abs(G[p + 1] - G[p - 1]) + Math.abs(B[p + 1] - B[p - 1])
                + Math.abs(R[p + w] - R[p - w]) + Math.abs(G[p + w] - G[p - w]) + Math.abs(B[p + w] - B[p - w]);
      }
    }
    const pLum = new Float32Array(NR * NA);
    const pGrad = new Float32Array(NR * NA);
    for (let rIdx = 0; rIdx < NR; rIdx++) {
      const rad = ((rIdx + 0.8) / NR) * maxRadius;
      for (let aIdx = 0; aIdx < NA; aIdx++) {
        const ang = (aIdx * 2 * Math.PI) / NA;
        const px = Math.round(cx + rad * Math.cos(ang));
        const py = Math.round(cy + rad * Math.sin(ang));
        let sl = 0, sg = 0, cnt = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const sx = px + dx, sy = py + dy;
            if (sx >= 1 && sx < w - 1 && sy >= 1 && sy < h - 1) {
              const p = sy * w + sx;
              sl += lum[p]; sg += grad[p]; cnt++;
            }
          }
        }
        const idx = rIdx * NA + aIdx;
        const mg = sg / cnt;
        let ml = sl / cnt;
        if (mg <= 24) ml = Math.min(ml, 25 + mg * 0.8);
        pLum[idx] = ml;
        pGrad[idx] = mg;
      }
    }
    return { lum: zNormalizePolarArray(pLum), grad: zNormalizePolarArray(pGrad) };
  }

  function solveRotateChallenge(boardData, options = {}) {
    if (!boardData || !boardData.data) return null;
    const bw = boardData.width || 220;
    const bh = boardData.height || 220;
    const bp = boardData.data;

    let dialCx = Math.round(bw / 2);
    let dialCy = Math.round(bh / 2);
    let dialImg = { width: bw, height: bh, data: bp };

    if (bw > 224 || bh > 224) {
      let minX = 9999, maxX = 0, minY = 9999, maxY = 0;
      const startY = bh > 350 ? Math.round(bh * 0.2) : 4;
      const endY = bh > 350 ? Math.round(bh * 0.76) : Math.min(bh - 4, 235);
      const startX = bw > 500 ? Math.round(bw * 0.2) : 4;
      const endX = (bw >= 420 && bh <= 300) ? Math.round(bw * 0.5) : (bw > 500 ? Math.round(bw * 0.8) : bw - 4);
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const i = (y * bw + x) * 4;
          const r = bp[i], g = bp[i + 1], b = bp[i + 2];
          if (r > 190 && g > 165 && b > 95 && b < 150 && (r - b) > 55) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      dialCx = (minX < maxX) ? Math.round((minX + maxX) / 2) : Math.round(bw * (270 / 538));
      dialCy = (minY < maxY) ? Math.round((minY + maxY) / 2) : Math.round(bh * (250 / 492));
      const crop = new Uint8ClampedArray(220 * 220 * 4);
      for (let y = 0; y < 220; y++) {
        for (let x = 0; x < 220; x++) {
          const sx = Math.max(0, Math.min(bw - 1, dialCx - 110 + x));
          const sy = Math.max(0, Math.min(bh - 1, dialCy - 110 + y));
          const si = (sy * bw + sx) * 4, di = (y * 220 + x) * 4;
          crop[di] = bp[si]; crop[di + 1] = bp[si + 1]; crop[di + 2] = bp[si + 2]; crop[di + 3] = 255;
        }
      }
      dialImg = { width: 220, height: 220, data: crop };
    }

    const catalog = getDecodedRotateCatalog();
    if (catalog.length > 0) {
      const NR = 5, NA = 24;
      const dPolars = [53, 56, 59].map(rad => extractDialCenteredPolar(dialImg, dialImg.width / 2, dialImg.height / 2, rad));
      const shiftScores = new Float32Array(NA).fill(-Infinity);
      for (let c = 0; c < catalog.length; c++) {
        const ip = catalog[c];
        for (let d = 0; d < dPolars.length; d++) {
          const dp = dPolars[d];
          for (let mirror = 0; mirror < 2; mirror++) {
            for (let shift = 0; shift < NA; shift++) {
              let corr = 0;
              for (let r = 0; r < NR; r++) {
                const row = r * NA;
                for (let a = 0; a < NA; a++) {
                  const ia = mirror === 1 ? ((12 - a + NA) % NA) : a;
                  const iIdx = row + ia;
                  const dIdx = row + ((a + shift) % NA);
                  corr += ip.lum[iIdx] * dp.lum[dIdx] * 1.15
                        + ip.grad[iIdx] * dp.grad[dIdx] * 1.45;
                }
              }
              corr /= (NR * NA);
              if (c === 289) {
                let cuffOuter = 0, cuffInner = 0;
                for (const ca of [17, 18, 19]) {
                  const da = (ca + shift) % NA;
                  cuffOuter += dp.grad[4 * NA + da];
                  cuffInner += dp.grad[1 * NA + da];
                }
                corr += (cuffOuter - cuffInner) * 0.04;
              }
              if (corr > shiftScores[shift]) {
                shiftScores[shift] = corr;
              }
            }
          }
        }
      }
      const ranked = [];
      for (let shift = 0; shift < NA; shift++) {
        const angleCW = shift * 15;
        let turn = angleCW === 0 ? 0 : -angleCW;
        if (turn <= -180) turn += 360;
        ranked.push({ shift, angleCW, turn, score: +shiftScores[shift].toFixed(3) });
      }
      ranked.sort((a, b) => b.score - a.score);
      const excludeRaw = options && options.excludeTurns;
      const excludeSet = excludeRaw instanceof Set
        ? excludeRaw
        : new Set(Array.isArray(excludeRaw) ? excludeRaw.map(Number) : []);
      const chosen = (excludeSet.size > 0 ? ranked.find(r => !excludeSet.has(r.turn)) : ranked[0]) || ranked[0];
      if (chosen && chosen.score >= 1.05) {
        const angleCW = chosen.angleCW;
        const turn = chosen.turn;
        const direction = turn < 0 ? 'ccw' : 'cw';
        const clicks = Math.round(Math.abs(turn) / 15);
        const confidence = Math.max(75, Math.min(99, Math.round(60 + chosen.score * 18)));
        return {
          angle: angleCW,
          turn,
          direction,
          clicks,
          confidence,
          score: chosen.score,
          ranked: ranked.slice(0, 6),
          dialX: dialCx,
          dialY: dialCy
        };
      }
    }

    const maxR = Math.round(Math.min(bw, bh) * 0.25);
    let m20 = 0, m02 = 0, m11 = 0;
    for (let y = Math.max(0, dialCy - maxR); y <= Math.min(bh - 1, dialCy + maxR); y++) {
      for (let x = Math.max(0, dialCx - maxR); x <= Math.min(bw - 1, dialCx + maxR); x++) {
        const d = Math.hypot(x - dialCx, y - dialCy);
        if (d > maxR) continue;
        const i = (y * bw + x) * 4;
        const lum = 0.299 * bp[i] + 0.587 * bp[i + 1] + 0.114 * bp[i + 2];
        if (lum > 60) {
          const dx = x - dialCx, dy = y - dialCy;
          m20 += dx * dx * lum;
          m02 += dy * dy * lum;
          m11 += dx * dy * lum;
        }
      }
    }

    const thetaRad = 0.5 * Math.atan2(2 * m11, m20 - m02);
    const deg = thetaRad * 180 / Math.PI;
    const direction = deg > 0 ? 'ccw' : 'cw';
    const clicks = Math.max(1, Math.min(12, Math.round(Math.abs(deg) / 15)));
    const turn = direction === 'ccw' ? -clicks * 15 : clicks * 15;

    return {
      angle: deg,
      turn,
      direction,
      clicks,
      confidence: 80,
      dialX: dialCx,
      dialY: dialCy
    };
  }

  return {
    normalizePrompt,
    resolveTargetItem,
    matchTemplateOnBoard,
    findGoldenFrame,
    extractBoxObject,
    compareObjects,
    findBottomCandidates,
    solveFrameChallenge,
    solveCountChallenge,
    solveOddChallenge,
    solveRotateChallenge
  };
});
