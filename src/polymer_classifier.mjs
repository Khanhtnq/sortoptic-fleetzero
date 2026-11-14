// SortOptic Spectral Classifier Core
// Simulates & analyzes Near-Infrared (NIR 900nm - 1700nm) + Visible RGB spectra
// Classifies RIC 1-7 Polymers and E-Waste PCB substrates with flame-retardant hazard scoring.

export const RIC_DEFINITIONS = {
  1: { code: 'PET', name: 'Polyethylene Terephthalate', recyclable: true, targetDensity: 1.38, nirBands: [1130, 1660] },
  2: { code: 'HDPE', name: 'High-Density Polyethylene', recyclable: true, targetDensity: 0.95, nirBands: [1215, 1395, 1730] },
  3: { code: 'PVC', name: 'Polyvinyl Chloride', recyclable: false, hazardous: true, targetDensity: 1.40, nirBands: [1195, 1420] },
  4: { code: 'LDPE', name: 'Low-Density Polyethylene', recyclable: true, targetDensity: 0.92, nirBands: [1210, 1725] },
  5: { code: 'PP', name: 'Polypropylene', recyclable: true, targetDensity: 0.90, nirBands: [1195, 1390, 1690] },
  6: { code: 'PS', name: 'Polystyrene', recyclable: true, targetDensity: 1.05, nirBands: [1140, 1680] },
  7: { code: 'OTHER', name: 'Multi-layer / Polycarbonate / Acrylic', recyclable: false, targetDensity: 1.20, nirBands: [1250, 1500] },
  8: { code: 'EWASTE_FR4', name: 'FR-4 Brominated Epoxy Glass PCB', recyclable: 'precious_metals_recovery', hazardous: true, targetDensity: 1.85, nirBands: [1430, 1610] },
  9: { code: 'EWASTE_ABS_FR', name: 'ABS Plastic with BFR Flame Retardant', recyclable: false, hazardous: true, targetDensity: 1.15, nirBands: [1150, 1380, 1630] }
};

/**
 * Generate a synthetic NIR spectrum with signature absorption valleys
 * @param {string|number} classId 
 * @param {number} noiseLevel (0.0 to 1.0)
 * @returns {Array<{wavelength: number, reflectance: number}>}
 */
export function generateSyntheticSpectrum(classId, noiseLevel = 0.03) {
  const def = RIC_DEFINITIONS[classId] || RIC_DEFINITIONS[7];
  const spectrum = [];
  
  for (let wl = 900; wl <= 1700; wl += 10) {
    // Base baseline reflectance (albedo)
    let ref = 0.75 - 0.00015 * (wl - 900);
    
    // Add characteristic dip for each signature band
    for (const band of def.nirBands) {
      const dist = Math.abs(wl - band);
      const sigma = 25; // band half-width in nm
      const dip = 0.45 * Math.exp(-(dist * dist) / (2 * sigma * sigma));
      ref -= dip;
    }
    
    // Add noise if requested
    if (noiseLevel > 0) {
      const noise = (Math.random() - 0.5) * 2 * noiseLevel;
      ref = Math.max(0.01, Math.min(0.99, ref + noise));
    }
    
    spectrum.push({ wavelength: wl, reflectance: parseFloat(ref.toFixed(4)) });
  }
  return spectrum;
}

/**
 * Classify a spectral sample across known reference polymer signatures using
 * full-spectrum MSE curve fitting + physical sensor fusion (density, halogen detection).
 * @param {Array<{wavelength: number, reflectance: number}>} sampleSpectrum
 * @param {object} metadata - optional physical sensors: { density, rgb: {r,g,b}, halogenTestRatio }
 */
export function classifyPolymerSpectrum(sampleSpectrum, metadata = {}) {
  let bestMatch = null;
  let lowestLoss = Infinity;
  const rawLosses = {};

  for (const [key, def] of Object.entries(RIC_DEFINITIONS)) {
    const refSpec = generateSyntheticSpectrum(key, 0);
    let mse = 0;
    const len = Math.min(sampleSpectrum.length, refSpec.length);
    for (let i = 0; i < len; i++) {
      const diff = sampleSpectrum[i].reflectance - refSpec[i].reflectance;
      mse += diff * diff;
    }
    mse = mse / len;

    let loss = mse;

    // Multi-modal physical sensor fusion if present
    if (metadata.density) {
      const densityDelta = Math.abs(metadata.density - def.targetDensity);
      loss += densityDelta * 0.04;
    }

    if (def.hazardous && metadata.halogenTestRatio !== undefined) {
      if (metadata.halogenTestRatio > 0.4) {
        loss -= 0.015; // Halogen confirmation aligns with FR4/ABS-FR/PVC
      }
    }

    rawLosses[key] = Math.max(1e-5, loss);

    if (loss < lowestLoss) {
      lowestLoss = loss;
      bestMatch = {
        ricCode: Number(key),
        ...def,
        loss: parseFloat(loss.toFixed(6))
      };
    }
  }

  // Convert losses into normalized confidence probabilities via inverse loss weighting
  const invLosses = {};
  let sumInv = 0;
  for (const [k, v] of Object.entries(rawLosses)) {
    invLosses[k] = 1 / (v + 0.005);
    sumInv += invLosses[k];
  }

  const normalizedProbabilities = {};
  for (const [k, v] of Object.entries(invLosses)) {
    normalizedProbabilities[k] = sumInv > 0 ? parseFloat((v / sumInv).toFixed(4)) : 0;
  }

  const confidence = normalizedProbabilities[bestMatch.ricCode] || 0.85;

  // Hazard analysis
  const isHazardous = !!bestMatch.hazardous;
  const hazardCategory = isHazardous 
    ? (bestMatch.ricCode === 3 ? 'Chlorinated_Dioxin_Risk' : 'Brominated_Flame_Retardant_RoHS_Violator')
    : 'None_Safe_Recyclable';

  // Contamination index detection
  // Evaluates closeness between top-1 and top-2 candidates or high residual variance
  const sortedProbs = Object.entries(normalizedProbabilities)
    .sort((a, b) => b[1] - a[1]);
  
  let contaminationIndex = 0;
  if (sortedProbs.length >= 2) {
    const diff = sortedProbs[0][1] - sortedProbs[1][1];
    // If second runner-up has comparable probability (>0.12 and diff < 0.05), sample is a blend/composite
    if (sortedProbs[1][1] > 0.12 && diff < 0.05) {
      contaminationIndex = parseFloat((1.0 - diff * 10).toFixed(3));
    } else if (bestMatch.loss > 0.008) {
      contaminationIndex = parseFloat(Math.min(1.0, bestMatch.loss * 50).toFixed(3));
    }
  }

  return {
    classifiedRic: bestMatch.ricCode,
    polymerCode: bestMatch.code,
    polymerName: bestMatch.name,
    recyclable: bestMatch.recyclable,
    isHazardous,
    hazardCategory,
    confidence: parseFloat((confidence * 100).toFixed(1)),
    contaminationIndex,
    allClassProbabilities: normalizedProbabilities
  };
}
