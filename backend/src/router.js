'use strict';

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function pointInPolygon(lat, lng, polygon) {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n-1; i < n; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if (((yi > lat) !== (yj > lat)) && lng < ((xj-xi)*(lat-yi)/(yj-yi)+xi)) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const [x1,y1]=p1,[x2,y2]=p2,[x3,y3]=p3,[x4,y4]=p4;
  const d1x=x2-x1,d1y=y2-y1,d2x=x4-x3,d2y=y4-y3;
  const cross=d1x*d2y-d1y*d2x;
  if (Math.abs(cross)<1e-10) return false;
  const t=((x3-x1)*d2y-(y3-y1)*d2x)/cross;
  const u=((x3-x1)*d1y-(y3-y1)*d1x)/cross;
  return t>=0&&t<=1&&u>=0&&u<=1;
}

function pathIntersectsZone(path, zone) {
  for (let i = 0; i < path.length-1; i++) {
    const a=[path[i].lat,path[i].lng], b=[path[i+1].lat,path[i+1].lng];
    for (let j = 0; j < zone.polygon.length; j++) {
      const c=zone.polygon[j], d=zone.polygon[(j+1)%zone.polygon.length];
      if (segmentsIntersect(a,b,c,d)) return true;
    }
    const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    if (pointInPolygon(mid[0],mid[1],zone.polygon)) return true;
  }
  return false;
}

const GRID_RES = 0.03;

function latLngToCell(lat, lng, bbox) {
  return {
    row: Math.floor((bbox.north - lat) / GRID_RES),
    col: Math.floor((lng - bbox.west) / GRID_RES),
  };
}

function cellToLatLng(row, col, bbox) {
  return {
    lat: bbox.north - (row + 0.5) * GRID_RES,
    lng: bbox.west  + (col + 0.5) * GRID_RES,
  };
}

function buildGrid(bbox, navigablePolygon, zones, weatherCostFn) {
  const rows = Math.ceil((bbox.north - bbox.south) / GRID_RES);
  const cols = Math.ceil((bbox.east  - bbox.west)  / GRID_RES);
  const blocked = [];
  const cost    = [];
  for (let r = 0; r < rows; r++) {
    blocked[r] = []; cost[r] = [];
    for (let c = 0; c < cols; c++) {
      const { lat, lng } = cellToLatLng(r, c, bbox);
      let isBlocked = !pointInPolygon(lat, lng, navigablePolygon);
      if (!isBlocked) {
        for (const z of zones) {
          if (z.polygon && pointInPolygon(lat, lng, z.polygon)) { isBlocked = true; break; }
        }
      }
      blocked[r][c] = isBlocked;
      cost[r][c] = (!isBlocked && weatherCostFn) ? weatherCostFn(lat, lng) : 1.0;
    }
  }
  return { blocked, cost, rows, cols };
}

function aStar(startCell, endCell, blocked, cost, rows, cols) {
  const key = (r,c) => r*cols+c;
  const open = new Map(), closed = new Set(), g = new Map(), parent = new Map();
  const heuristic = (r,c) => Math.abs(r-endCell.row)+Math.abs(c-endCell.col);
  const sk = key(startCell.row, startCell.col);
  g.set(sk, 0); open.set(sk, heuristic(startCell.row, startCell.col));

  const getMin = () => { let mk=null,mv=Infinity; for (const [k,v] of open) if(v<mv){mv=v;mk=k;} return mk; };

  while (open.size > 0) {
    const ck = getMin(); if (ck===null) break;
    const cr=Math.floor(ck/cols), cc=ck%cols;
    if (cr===endCell.row && cc===endCell.col) {
      const path=[]; let k=ck;
      while(parent.has(k)){const r=Math.floor(k/cols),c=k%cols;path.unshift({row:r,col:c});k=parent.get(k);}
      path.unshift({row:startCell.row,col:startCell.col});
      return path;
    }
    open.delete(ck); closed.add(ck);
    for (const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
      const nr=cr+dr, nc=cc+dc;
      if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
      if (blocked[nr][nc]) continue;
      const nk=key(nr,nc); if (closed.has(nk)) continue;
      const moveCost=(Math.abs(dr)+Math.abs(dc)===2?1.414:1.0)*cost[nr][nc];
      const ng=(g.get(ck)||0)+moveCost;
      if (!g.has(nk)||ng<g.get(nk)) {
        g.set(nk,ng); parent.set(nk,ck); open.set(nk,ng+heuristic(nr,nc));
      }
    }
  }
  return null;
}

function simplifyPath(waypoints) {
  if (waypoints.length<=2) return waypoints;
  const result=[waypoints[0]];
  for (let i=1;i<waypoints.length-1;i++) {
    const prev=result[result.length-1];
    const d=Math.sqrt((waypoints[i].lat-prev.lat)**2+(waypoints[i].lng-prev.lng)**2);
    if (d>=0.25) result.push(waypoints[i]);
  }
  result.push(waypoints[waypoints.length-1]);
  return result;
}

function computeRoute(ship, destination, zones, navigablePolygon, bbox, weatherCostFn=null) {
  const { blocked, cost, rows, cols } = buildGrid(bbox, navigablePolygon, zones, weatherCostFn);
  const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
  const sc = latLngToCell(ship.lat, ship.lng, bbox);
  const ec = latLngToCell(destination.lat, destination.lng, bbox);
  sc.row=clamp(sc.row,0,rows-1); sc.col=clamp(sc.col,0,cols-1);
  ec.row=clamp(ec.row,0,rows-1); ec.col=clamp(ec.col,0,cols-1);

  // Unblock start cell and a 2-cell radius around it (ships may be at polygon boundary)
  for (let dr=-2; dr<=2; dr++) for (let dc=-2; dc<=2; dc++) {
    const nr=clamp(sc.row+dr,0,rows-1), nc=clamp(sc.col+dc,0,cols-1);
    blocked[nr][nc] = false;
  }
  // Unblock end cell and 2-cell radius
  for (let dr=-2; dr<=2; dr++) for (let dc=-2; dc<=2; dc++) {
    const nr=clamp(ec.row+dr,0,rows-1), nc=clamp(ec.col+dc,0,cols-1);
    blocked[nr][nc] = false;
  }

  const cellPath=aStar(sc,ec,blocked,cost,rows,cols);
  if (!cellPath) {
    // Fallback: If no path found (grid issue), and cross-strait, use a waypoint.
    const isPersianGulf = (lng) => lng < 55.8;
    const isGulfOman = (lng) => lng > 56.6;
    if ((isPersianGulf(ship.lng) && isGulfOman(destination.lng)) || (isGulfOman(ship.lng) && isPersianGulf(destination.lng))) {
      return [
        { lat: ship.lat, lng: ship.lng },
        { lat: 26.45, lng: 56.25 }, // Strait of Hormuz waypoint
        { lat: destination.lat, lng: destination.lng }
      ];
    }
    // Final fallback: direct straight line
    return [{ lat:ship.lat, lng:ship.lng }, { lat:destination.lat, lng:destination.lng }];
  }
  return simplifyPath(cellPath.map(({row,col})=>cellToLatLng(row,col,bbox)));
}

// ── Multiple route options (bonus) ──────────────────────────────────────────
function computeMultipleRoutes(ship, destination, zones, navigablePolygon, bbox, weatherCostFn) {
  const routes = [];

  // 1. Fastest: Direct line, max speed
  const fast = computeRoute(ship, destination, zones, navigablePolygon, bbox, null);
  if (!fast) return [];
  const distFast = pathDistance(fast);

  routes.push({
    id: 'fastest', label: '⚡ Fastest', weatherRisk: 'high',
    description: 'Direct route at maximum speed. Higher fuel consumption.',
    path: fast,
    distanceKm: distFast,
    fuelTons: distFast * 1.0,
  });

  // 2. Fuel-Efficient: 1x weather cost, optimal speed
  const balanced = computeRoute(ship, destination, zones, navigablePolygon, bbox, weatherCostFn);
  const diffBalanced = routesDiffer(fast, balanced);
  const pathBal = diffBalanced ? balanced : fast;
  const distBal = pathDistance(pathBal);

  routes.push({
    id: 'efficient', label: '🍃 Fuel-Efficient', weatherRisk: 'medium',
    description: 'Optimized cruising speed to save fuel.',
    path: pathBal,
    distanceKm: distBal,
    fuelTons: distBal * 0.6,
  });

  // 3. Weather-Safe: High weather avoidance
  const heavyFn = weatherCostFn
    ? (lat, lng) => { const c = weatherCostFn(lat, lng); return c > 1 ? 1 + ((c - 1) * 5) : 1; }
    : null;
  const safe = heavyFn ? computeRoute(ship, destination, zones, navigablePolygon, bbox, heavyFn) : null;
  const diffSafe = routesDiffer(fast, safe) && routesDiffer(pathBal, safe);

  if (diffSafe && safe) {
    routes.push({
      id: 'safe', label: '🛡️ Weather-Safe', weatherRisk: 'low',
      description: 'Longer path but strictly avoids adverse weather.',
      path: safe,
      distanceKm: pathDistance(safe),
      fuelTons: pathDistance(safe) * 0.8,
    });
  } else {
    // Provide a distinct 3rd option if weather doesn't force a reroute
    routes.push({
      id: 'safe', label: '🛡️ Cautious', weatherRisk: 'low',
      description: 'Reduced speed and heightened radar vigilance.',
      path: pathBal,
      distanceKm: distBal,
      fuelTons: distBal * 0.75,
    });
  }

  return routes;
}

function pathDistance(path) {
  let d=0;
  for (let i=0;i<path.length-1;i++) d+=haversine(path[i].lat,path[i].lng,path[i+1].lat,path[i+1].lng);
  return Math.round(d);
}

function routesDiffer(a, b) {
  if (!a || !b) return true;
  if (a.length !== b.length) return true;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff += haversine(a[i].lat, a[i].lng, b[i].lat, b[i].lng);
  }
  return diff > 10; // If cumulative deviation is > 10km, they are different paths
}

function estimateFuelForPath(path, fuelPerKm) {
  return pathDistance(path) * fuelPerKm;
}

module.exports = {
  computeRoute, computeMultipleRoutes, doesPathCrossZones: pathIntersectsZone,
  haversine, pointInPolygon, pathIntersectsZone, estimateFuelForPath, pathDistance,
};
