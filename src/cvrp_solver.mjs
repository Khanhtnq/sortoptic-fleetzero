// FleetZero CVRP Solver: Capacitated Vehicle Routing Problem
// Integrates Clarke-Wright Savings Heuristic + Iterative 2-Opt Local Search
// For Municipal Smart Waste / Polymer Bin Routing with fleet km & CO2 reduction tracking.

/**
 * Calculate Euclidean distance between two nodes
 */
export function euclideanDist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/**
 * Calculate total route distance for a sequence of nodes starting and ending at depot
 */
export function calculateRouteDistance(route, depot) {
  if (route.length === 0) return 0;
  let dist = euclideanDist(depot, route[0]);
  for (let i = 0; i < route.length - 1; i++) {
    dist += euclideanDist(route[i], route[i + 1]);
  }
  dist += euclideanDist(route[route.length - 1], depot);
  return dist;
}

/**
 * Calculate total distance across an array of routes
 */
export function calculateFleetDistance(routes, depot) {
  return routes.reduce((sum, r) => sum + calculateRouteDistance(r, depot), 0);
}

/**
 * 2-Opt Local Search optimization on a single closed route
 * Reverses segments to eliminate edge-crossings
 */
export function optimize2Opt(route, depot, maxIterations = 500) {
  if (route.length <= 2) return [...route];
  
  let currentRoute = [...route];
  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;
    const bestDist = calculateRouteDistance(currentRoute, depot);

    for (let i = 0; i < currentRoute.length - 1; i++) {
      for (let k = i + 1; k < currentRoute.length; k++) {
        // Construct 2-opt swap
        const newRoute = [
          ...currentRoute.slice(0, i),
          ...currentRoute.slice(i, k + 1).reverse(),
          ...currentRoute.slice(k + 1)
        ];

        const newDist = calculateRouteDistance(newRoute, depot);
        if (newDist < bestDist - 1e-4) {
          currentRoute = newRoute;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return currentRoute;
}

/**
 * Naive Nearest-Neighbor CVRP (baseline for comparison)
 */
export function solveNearestNeighborCVRP(depot, customers, vehicleCapacity) {
  const unvisited = [...customers];
  const routes = [];

  while (unvisited.length > 0) {
    const currentRoute = [];
    let currentCapacity = 0;
    let currentPos = depot;

    while (unvisited.length > 0) {
      let nearestIdx = -1;
      let minDistance = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const cust = unvisited[i];
        if (currentCapacity + cust.demand <= vehicleCapacity) {
          const d = euclideanDist(currentPos, cust);
          if (d < minDistance) {
            minDistance = d;
            nearestIdx = i;
          }
        }
      }

      if (nearestIdx !== -1) {
        const nextCust = unvisited.splice(nearestIdx, 1)[0];
        currentRoute.push(nextCust);
        currentCapacity += nextCust.demand;
        currentPos = nextCust;
      } else {
        break; // Vehicle full or no fitting customers, return to depot
      }
    }

    if (currentRoute.length > 0) {
      routes.push(currentRoute);
    } else {
      // Emergency fallback if a customer exceeds vehicle capacity
      const forced = unvisited.shift();
      routes.push([forced]);
    }
  }

  return routes;
}

/**
 * Clarke-Wright Savings Heuristic + 2-Opt Local Search CVRP Optimizer
 */
export function solveClarkeWrightCVRP(depot, customers, vehicleCapacity) {
  // Step 1: Initialize individual routes depot -> customer -> depot
  const routes = customers.map(c => [c]);
  const routeDemand = customers.map(c => c.demand);

  // Step 2: Compute pairwise savings s(i, j) = d(depot, i) + d(depot, j) - d(i, j)
  const savings = [];
  for (let i = 0; i < customers.length; i++) {
    for (let j = i + 1; j < customers.length; j++) {
      const ci = customers[i];
      const cj = customers[j];
      const s = euclideanDist(depot, ci) + euclideanDist(depot, cj) - euclideanDist(ci, cj);
      savings.push({ i: ci.id, j: cj.id, saving: s });
    }
  }

  // Sort savings descending
  savings.sort((a, b) => b.saving - a.saving);

  // Step 3: Merge routes according to savings while respecting vehicleCapacity
  for (const { i, j } of savings) {
    let routeIdxI = routes.findIndex(r => r.some(c => c.id === i));
    let routeIdxJ = routes.findIndex(r => r.some(c => c.id === j));

    if (routeIdxI !== -1 && routeIdxJ !== -1 && routeIdxI !== routeIdxJ) {
      const rI = routes[routeIdxI];
      const rJ = routes[routeIdxJ];
      const combinedDemand = rI.reduce((sum, c) => sum + c.demand, 0) +
                             rJ.reduce((sum, c) => sum + c.demand, 0);

      if (combinedDemand <= vehicleCapacity) {
        // Check if mergeable at endpoints
        const iFirst = rI[0].id === i;
        const iLast = rI[rI.length - 1].id === i;
        const jFirst = rJ[0].id === j;
        const jLast = rJ[rJ.length - 1].id === j;

        let merged = null;
        if (iLast && jFirst) {
          merged = [...rI, ...rJ];
        } else if (iFirst && jLast) {
          merged = [...rJ, ...rI];
        } else if (iLast && jLast) {
          merged = [...rI, ...[...rJ].reverse()];
        } else if (iFirst && jFirst) {
          merged = [[...rI].reverse(), ...rJ].flat();
        }

        if (merged) {
          routes.splice(Math.max(routeIdxI, routeIdxJ), 1);
          routes.splice(Math.min(routeIdxI, routeIdxJ), 1);
          routes.push(merged);
        }
      }
    }
  }

  // Step 4: Refine each vehicle route with 2-Opt local search
  const optimizedRoutes = routes.map(r => optimize2Opt(r, depot));
  return optimizedRoutes;
}

/**
 * Compare Savings + 2-Opt with Baseline Nearest-Neighbor
 * Returns complete fleet metrics: distances, km saved, CO2 kg saved (0.24 kg/km for urban collection truck)
 */
export function benchmarkFleetOptimization(depot, customers, vehicleCapacity) {
  const naiveRoutes = solveNearestNeighborCVRP(depot, customers, vehicleCapacity);
  const naiveDist = calculateFleetDistance(naiveRoutes, depot);

  const smartRoutes = solveClarkeWrightCVRP(depot, customers, vehicleCapacity);
  const smartDist = calculateFleetDistance(smartRoutes, depot);

  const distSaved = Math.max(0, naiveDist - smartDist);
  const percentSaved = naiveDist > 0 ? (distSaved / naiveDist) * 100 : 0;
  
  // Diesel waste collection truck emits approx 0.85 kg CO2 per km
  const co2FactorKgPerKm = 0.85;
  const naiveCo2Kg = naiveDist * co2FactorKgPerKm;
  const smartCo2Kg = smartDist * co2FactorKgPerKm;
  const co2SavedKg = distSaved * co2FactorKgPerKm;

  return {
    naive: {
      routeCount: naiveRoutes.length,
      totalDistanceKm: parseFloat(naiveDist.toFixed(2)),
      co2Kg: parseFloat(naiveCo2Kg.toFixed(2)),
      routes: naiveRoutes
    },
    smart: {
      routeCount: smartRoutes.length,
      totalDistanceKm: parseFloat(smartDist.toFixed(2)),
      co2Kg: parseFloat(smartCo2Kg.toFixed(2)),
      routes: smartRoutes
    },
    improvement: {
      distanceSavedKm: parseFloat(distSaved.toFixed(2)),
      percentSaved: parseFloat(percentSaved.toFixed(2)),
      co2SavedKg: parseFloat(co2SavedKg.toFixed(2))
    }
  };
}
