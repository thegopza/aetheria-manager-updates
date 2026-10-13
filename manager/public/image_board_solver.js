'use strict';

/**
 * PmheeAether Human Check Image Board Auto-Solver Module
 * Handles prompt parsing, catalog resolution, and multi-scale template matching
 * for coordinate-based captcha boards.
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

    for (let y = 20; y < Math.min(160, bh); y++) {
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
    if (count >= 30 && fw >= 45 && fw <= 130 && fh >= 45 && fh <= 130) {
      return { x: minX, y: minY, width: fw, height: fh };
    }
    return { x: 200, y: 50, width: 80, height: 80 };
  }

  function solveFrameChallenge(boardData) {
    if (!boardData || !boardData.data) return null;
    const bw = boardData.width;
    const bh = boardData.height;
    const bp = boardData.data;

    const frame = findGoldenFrame(boardData);
    if (!frame) return null;

    const inset = 8;
    const fx1 = frame.x + inset;
    const fy1 = frame.y + inset;
    const fx2 = frame.x + frame.width - inset;
    const fy2 = frame.y + frame.height - inset;

    // Sample corner pixels to estimate background inside frame
    const corners = [
      [fx1, fy1], [fx2, fy1], [fx1, fy2], [fx2, fy2],
      [fx1 + 4, fy1 + 4], [fx2 - 4, fy1 + 4], [fx1 + 4, fy2 - 4], [fx2 - 4, fy2 - 4]
    ];
    let bgR = 0, bgG = 0, bgB = 0;
    for (const [cx, cy] of corners) {
      const idx = (cy * bw + cx) * 4;
      bgR += bp[idx];
      bgG += bp[idx + 1];
      bgB += bp[idx + 2];
    }
    bgR /= corners.length;
    bgG /= corners.length;
    bgB /= corners.length;

    // Find foreground item pixels inside frame
    let itemMinX = Infinity, itemMaxX = -Infinity;
    let itemMinY = Infinity, itemMaxY = -Infinity;
    const foregroundPixels = [];

    for (let y = fy1; y <= fy2; y++) {
      for (let x = fx1; x <= fx2; x++) {
        const idx = (y * bw + x) * 4;
        const r = bp[idx];
        const g = bp[idx + 1];
        const b = bp[idx + 2];
        const diffFromBg = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
        if (diffFromBg > 45 || (r + g + b) > 180) {
          if (x < itemMinX) itemMinX = x;
          if (x > itemMaxX) itemMaxX = x;
          if (y < itemMinY) itemMinY = y;
          if (y > itemMaxY) itemMaxY = y;
          foregroundPixels.push({ x, y, r, g, b });
        }
      }
    }

    let template = [];
    let itemCenterX, itemCenterY;

    if (foregroundPixels.length >= 20 && itemMaxX > itemMinX && itemMaxY > itemMinY) {
      itemCenterX = Math.round((itemMinX + itemMaxX) / 2);
      itemCenterY = Math.round((itemMinY + itemMaxY) / 2);
      for (const p of foregroundPixels) {
        template.push(p.x - itemCenterX, p.y - itemCenterY, p.r, p.g, p.b);
      }
    } else {
      itemCenterX = Math.round(frame.x + frame.width / 2);
      itemCenterY = Math.round(frame.y + frame.height / 2);
      for (let dy = -20; dy <= 20; dy += 2) {
        for (let dx = -20; dx <= 20; dx += 2) {
          const idx = ((itemCenterY + dy) * bw + (itemCenterX + dx)) * 4;
          template.push(dx, dy, bp[idx], bp[idx + 1], bp[idx + 2]);
        }
      }
    }

    const sampleCount = template.length / 5;
    if (sampleCount < 10) return null;

    // Scan bottom candidate area (y: 175 to bh - 25, x: 25 to bw - 25)
    const startY = 175;
    const endY = bh - 25;
    const startX = 25;
    const endX = bw - 25;
    const step = 3;

    let bestScore = Infinity;
    let bestCX = 0;
    let bestCY = 0;

    for (let cy = startY; cy <= endY; cy += step) {
      for (let cx = startX; cx <= endX; cx += step) {
        let diffSum = 0;
        for (let m = 0; m < template.length; m += 5) {
          const px = cx + template[m];
          const py = cy + template[m + 1];
          if (px < 0 || px >= bw || py < 0 || py >= bh) {
            diffSum += 500;
            continue;
          }
          const bIdx = (py * bw + px) * 4;
          diffSum += Math.abs(bp[bIdx] - template[m + 2])
                   + Math.abs(bp[bIdx + 1] - template[m + 3])
                   + Math.abs(bp[bIdx + 2] - template[m + 4]);
        }
        const mae = diffSum / sampleCount;
        if (mae < bestScore) {
          bestScore = mae;
          bestCX = cx;
          bestCY = cy;
        }
      }
    }

    // Fine scan around coarse best (step = 1)
    let fineBestScore = bestScore;
    let fineBestCX = bestCX;
    let fineBestCY = bestCY;

    for (let cy = Math.max(startY, bestCY - step); cy <= Math.min(endY, bestCY + step); cy++) {
      for (let cx = Math.max(startX, bestCX - step); cx <= Math.min(endX, bestCX + step); cx++) {
        let diffSum = 0;
        for (let m = 0; m < template.length; m += 5) {
          const px = cx + template[m];
          const py = cy + template[m + 1];
          if (px < 0 || px >= bw || py < 0 || py >= bh) {
            diffSum += 500;
            continue;
          }
          const bIdx = (py * bw + px) * 4;
          diffSum += Math.abs(bp[bIdx] - template[m + 2])
                   + Math.abs(bp[bIdx + 1] - template[m + 3])
                   + Math.abs(bp[bIdx + 2] - template[m + 4]);
        }
        const mae = diffSum / sampleCount;
        if (mae < fineBestScore) {
          fineBestScore = mae;
          fineBestCX = cx;
          fineBestCY = cy;
        }
      }
    }

    const confidence = Math.max(0, Math.min(100, Math.round(100 - (fineBestScore / 2.5))));

    return {
      targetX: fineBestCX,
      targetY: fineBestCY,
      centerX: fineBestCX,
      centerY: fineBestCY,
      x: fineBestCX,
      y: fineBestCY,
      mae: fineBestScore,
      score: fineBestScore,
      confidence,
      frame,
      matchedName: 'รูปในกรอบ'
    };
  }

  return {
    normalizePrompt,
    resolveTargetItem,
    matchTemplateOnBoard,
    findGoldenFrame,
    solveFrameChallenge
  };
});

