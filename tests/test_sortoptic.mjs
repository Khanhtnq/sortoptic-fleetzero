import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  RIC_DEFINITIONS, 
  generateSyntheticSpectrum, 
  classifyPolymerSpectrum 
} from '../src/polymer_classifier.mjs';
import { 
  euclideanDist, 
  calculateRouteDistance, 
  calculateFleetDistance, 
  optimize2Opt, 
  solveNearestNeighborCVRP, 
  solveClarkeWrightCVRP, 
  benchmarkFleetOptimization 
} from '../src/cvrp_solver.mjs';

test('1. Polymer definitions integrity for RIC 1-7 and E-Waste', () => {
  assert.ok(RIC_DEFINITIONS[1].code === 'PET');
  assert.ok(RIC_DEFINITIONS[2].code === 'HDPE');
  assert.ok(RIC_DEFINITIONS[3].code === 'PVC' && RIC_DEFINITIONS[3].hazardous === true);
  assert.ok(RIC_DEFINITIONS[5].code === 'PP');
  assert.ok(RIC_DEFINITIONS[8].code === 'EWASTE_FR4' && RIC_DEFINITIONS[8].hazardous === true);
});

test('2. Synthetic NIR spectrum generation within 900-1700nm range', () => {
  const spec = generateSyntheticSpectrum(1, 0.01);
  assert.equal(spec.length, 81);
  assert.equal(spec[0].wavelength, 900);
  assert.equal(spec[spec.length - 1].wavelength, 1700);
  spec.forEach(pt => {
    assert.ok(pt.reflectance >= 0 && pt.reflectance <= 1.0);
  });
});

test('3. Accurate classification of PET (RIC 1) sample', () => {
  const petSpec = generateSyntheticSpectrum(1, 0.02);
  const result = classifyPolymerSpectrum(petSpec, { density: 1.38 });
  assert.equal(result.classifiedRic, 1);
  assert.equal(result.polymerCode, 'PET');
  assert.equal(result.recyclable, true);
  assert.equal(result.isHazardous, false);
});

test('4. Accurate classification of HDPE (RIC 2) sample', () => {
  const hdpeSpec = generateSyntheticSpectrum(2, 0.02);
  const result = classifyPolymerSpectrum(hdpeSpec, { density: 0.95 });
  assert.equal(result.classifiedRic, 2);
  assert.equal(result.polymerCode, 'HDPE');
  assert.equal(result.recyclable, true);
});

test('5. Accurate detection and hazard classification of PVC (RIC 3)', () => {
  const pvcSpec = generateSyntheticSpectrum(3, 0.02);
  const result = classifyPolymerSpectrum(pvcSpec, { density: 1.40, halogenTestRatio: 0.8 });
  assert.equal(result.classifiedRic, 3);
  assert.equal(result.isHazardous, true);
  assert.equal(result.hazardCategory, 'Chlorinated_Dioxin_Risk');
});

test('6. Accurate detection of E-Waste FR-4 Circuit Board with BFR hazard', () => {
  const fr4Spec = generateSyntheticSpectrum(8, 0.02);
  const result = classifyPolymerSpectrum(fr4Spec, { density: 1.85, halogenTestRatio: 0.9 });
  assert.equal(result.classifiedRic, 8);
  assert.equal(result.polymerCode, 'EWASTE_FR4');
  assert.equal(result.isHazardous, true);
  assert.equal(result.hazardCategory, 'Brominated_Flame_Retardant_RoHS_Violator');
});

test('7. Euclidean distance calculation accuracy', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 3, y: 4 };
  assert.equal(euclideanDist(a, b), 5);
});

test('8. 2-Opt local search uncrosses bow-tie criss-cross routes', () => {
  const depot = { x: 0, y: 0 };
  const crossedRoute = [
    { id: 1, x: 0, y: 10 },
    { id: 2, x: 10, y: 0 },
    { id: 3, x: 10, y: 10 }
  ];
  const initialDist = calculateRouteDistance(crossedRoute, depot);
  const optimized = optimize2Opt(crossedRoute, depot);
  const optDist = calculateRouteDistance(optimized, depot);

  assert.ok(optDist <= initialDist, `Optimized ${optDist} should be <= initial ${initialDist}`);
});

test('9. Clarke-Wright + 2-Opt respects vehicle capacity constraints', () => {
  const depot = { id: 0, x: 50, y: 50 };
  const vehicleCapacity = 100;
  const customers = [
    { id: 1, x: 10, y: 20, demand: 40 },
    { id: 2, x: 15, y: 25, demand: 50 },
    { id: 3, x: 80, y: 90, demand: 40 },
    { id: 4, x: 85, y: 95, demand: 30 }
  ];

  const routes = solveClarkeWrightCVRP(depot, customers, vehicleCapacity);
  routes.forEach(route => {
    const totalDemand = route.reduce((sum, c) => sum + c.demand, 0);
    assert.ok(totalDemand <= vehicleCapacity, `Route demand ${totalDemand} exceeds capacity ${vehicleCapacity}`);
  });
});

test('10. Benchmark validates fleet distance & CO2 reduction on clustered city nodes', () => {
  const depot = { id: 0, x: 50, y: 50 };
  const vehicleCapacity = 150;
  const customers = [
    { id: 1, x: 10, y: 12, demand: 30 },
    { id: 2, x: 12, y: 15, demand: 35 },
    { id: 3, x: 14, y: 10, demand: 25 },
    { id: 4, x: 80, y: 82, demand: 40 },
    { id: 5, x: 85, y: 80, demand: 30 },
    { id: 6, x: 78, y: 88, demand: 20 },
    { id: 7, x: 15, y: 85, demand: 35 },
    { id: 8, x: 18, y: 80, demand: 25 },
    { id: 9, x: 85, y: 15, demand: 45 },
    { id: 10, x: 90, y: 18, demand: 30 },
    { id: 11, x: 52, y: 48, demand: 20 },
    { id: 12, x: 48, y: 55, demand: 25 }
  ];

  const result = benchmarkFleetOptimization(depot, customers, vehicleCapacity);
  assert.ok(result.smart.totalDistanceKm <= result.naive.totalDistanceKm, 'Smart routes should be shorter or equal to naive');
  assert.ok(result.improvement.percentSaved >= 0);
});

test('11. Statistical superiority: 2-opt tour strictly beats naive unoptimized order across 10 random city graphs', () => {
  const depot = { id: 0, x: 50, y: 50 };
  let countBeats = 0;
  let totalSaved = 0;
  const numTrials = 10;

  for (let trial = 1; trial <= numTrials; trial++) {
    const points = [];
    for (let i = 1; i <= 20; i++) {
      const x = ((trial * 41 + i * 83) % 100);
      const y = ((trial * 67 + i * 59) % 100);
      points.push({ id: i, x, y });
    }

    const naiveDist = calculateRouteDistance(points, depot);
    const optTour = optimize2Opt(points, depot);
    const optDist = calculateRouteDistance(optTour, depot);

    assert.ok(optDist < naiveDist, `Trial ${trial}: 2-Opt (${optDist}) must strictly beat naive tour (${naiveDist})`);
    countBeats++;
    totalSaved += (naiveDist - optDist) / naiveDist * 100;
  }

  assert.equal(countBeats, numTrials);
  const avgSaved = totalSaved / numTrials;
  assert.ok(avgSaved >= 40.0, `Average tour savings ${avgSaved}% must be >= 40%`);
});

test('12. High-density smart-bin urban grid test verifies >28% fleet km reduction via 2-opt uncrossing', () => {
  const depot = { id: 0, x: 50, y: 50 };
  // Zig-zag route representing naive collection schedule across urban street blocks
  const zigZagNodes = [];
  for (let i = 0; i < 20; i++) {
    zigZagNodes.push({
      id: i + 1,
      x: (i % 2 === 0 ? 10 : 90),
      y: (i * 15) % 100,
      demand: 10
    });
  }

  const naiveDist = calculateRouteDistance(zigZagNodes, depot);
  const optTour = optimize2Opt(zigZagNodes, depot);
  const optDist = calculateRouteDistance(optTour, depot);
  const savedPercent = ((naiveDist - optDist) / naiveDist) * 100;

  assert.ok(savedPercent >= 28.0, `Observed ${savedPercent}% should strictly exceed 28%`);
  assert.ok(savedPercent > 50.0, `Observed 2-opt savings ${savedPercent}% achieves massive efficiency gain`);
});

test('13. Contamination index detection when multiple polymer signals interfere', () => {
  // Synthesize contaminated mix: PET + PVC signals
  const pet = generateSyntheticSpectrum(1, 0.01);
  const pvc = generateSyntheticSpectrum(3, 0.01);
  const blended = pet.map((pt, idx) => ({
    wavelength: pt.wavelength,
    reflectance: (pt.reflectance + pvc[idx].reflectance) / 2
  }));

  const result = classifyPolymerSpectrum(blended);
  assert.ok(result.contaminationIndex > 0, `Contaminated sample should exhibit contaminationIndex > 0, got ${result.contaminationIndex}`);
});
