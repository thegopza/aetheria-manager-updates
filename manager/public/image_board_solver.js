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
                const np = (ly + dy) * w + (lx + dx);
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

  return {
    normalizePrompt,
    resolveTargetItem,
    matchTemplateOnBoard,
    findGoldenFrame,
    extractBoxObject,
    compareObjects,
    findBottomCandidates,
    solveFrameChallenge
  };
});
