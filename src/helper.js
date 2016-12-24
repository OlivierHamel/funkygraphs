'use strict';

function assert(condition, message)
{ if (!condition) throw message || "Assertion failed"; }

// stolen from: http://blog.carbonfive.com/2015/01/14/gettin-freaky-functional-wcurried-javascript/
// because screw any language without currying.
function curry(fx) {
  var arity = fx.length;

  return function f1() {
    var args = Array.prototype.slice.call(arguments, 0);
    if (args.length >= arity) {
      return fx.apply(null, args);
    }
    else {
      return function f2() {
        var args2 = Array.prototype.slice.call(arguments, 0);
        return f1.apply(null, args.concat(args2)); 
      }
    }
  };
}

function toMap(fnKey, ary) {
  var m = {};
  pairsKV((_, v) => { m[fnKey(v)] = v; }, ary);
  return m;
}

function toArray(o) {
  var m = [];
  pairsKV((_, v) => { m.push(v); }, o);
  return m; 
}

function emptyObj(o) {
  assert(o);
  if (Array.isArray(o))
    return o.length == 0;

  for (var k in o) {
    if (o.hasOwnProperty(k))
      return false;
  } 

  return true;
}

function filterKV(f, m) {
  return fmapKV((k, v) => f(k, v) ? undefined : v, m);
}

function pairsKV(f, m) {
  assert(m);
  for (var k in m) {
    if (m.hasOwnProperty(k))
      f(k, m[k])
  }
}

function foldKV(f, z, m) {
  var s = z;
  pairsKV((k, v) => { s = f(s, k, v); }, m);
  return s;
}

function fmapKV(f, m) {
  if (Array.isArray(m)) {
    var m2 = [];
    for (var i = 0; i < m.length; ++i) {
      var v = f(i, m[i]);
      if (v !== undefined)
        m2.push(v);
    }
    return m2;
  }

  var m2 = {};
  pairsKV((k, v) => {
    m2[k] = f(k, v);
    if (m2[k] === undefined)
      delete m2[k];
  }, m);
  return m2;
}

function foldFlatten(fnFolder) {
  var l = []
  fnFolder((v) => l.push(v));
  return l;
}

function roseTreeClone(n) {
  return { name     : n.name
         , value    : n.value
         , children : fmapKV((_, v) => roseTreeClone(v)
                            ,n.children)
         };
}

function roseTreeMerge(a, b) {
  assert(a);
  assert(b);
  //console.log("Merge: ", a.name, a, b);
  assert(a !== b);
  assert(a.name === b.name);

  return  { name    : a.name
          , value   : a.value + b.value
          , children: (() => {
              var kids = fmapKV((k, v) => {
                  return b.children[k] ? roseTreeMerge(v, b.children[k])
                                       : v;
                }, a.children);

              pairsKV((k, v) => { kids[k] = kids[k] || v; }
                     ,b.children);
              return kids;
            })()
          };
}

/*
function roseTreeFoldDirect(n) {
  // *!* destructive *!* merges b into a
  function mergeNodes(a, b) {
      console.log("Merge: ", a.name, a, b);
      assert(a !== b);
      assert(a.name === b.name);
      
      var byNameA = toMap(a.children);
      pairsKV((k, v) => {
        byNameA[k] = byNameA[k] ? mergeNodes(byNameA[k], v)
                                : v;
      }, toMap(b.children));

      a.value += b.value;
      a.children = toArray(byNameA);
      return a;
  }

  function lookupExtend(mapFL, n) {
      if (mapFL[n.name]) return [mapFL, true];
      
      var m           = { };//__index = mapFL *};
          m[n.name]   = { mapFL: mapFL
                        , nodes: [] };
      //setmetatable(m, m)
      return [m, false];
  }

  function fold(mapFrameList, n) {
      var extRes  = lookupExtend(mapFrameList, n);
      var mapFL   = extRes[0]
        , bFold   = extRes[1]
        , sibs    = mapFL[n.name].nodes
      
      n.children = fmapKV((_, v) => fold(mapFL, v)
                         ,n.children || []);

      if (!bFold) {
          return foldKV((a, _, v) => mergeNodes(a, v) 
                       ,n, sibs);
      } else {
          sibs.push(n);
          return undefined;
      }
  }

  // clone tree since our merging is destructive
  return fold({}, roseTreeClone(n));
}
*/


function deriveFoldr(fnKids) {
  var fold = function(f, z, r) {
    assert(r);
    var s = z;
    fnKids((v) => { s = fold(f, s, v); }
          ,r);
    return f(s, r);
  };

  return fold;
}

function deriveFmapDeepPre(fnClone, fmapKids) {
  return function(f, r) {
    assert(r);
    function fmapMut(n) {
      assert(n);
      var n2 = f(n);
      if (n2 === undefined) return undefined;

      fmapKids(fmapMut, n2);
      return n2;
    }

    return fmapMut(fnClone(r));
  }
}

function deriveFmapDeepPost(fnClone, fmapKids) {
  return function(f, r) {
    assert(r);
    function fmapMut(n) {
      assert(n);
      fmapKids(fmapMut, n);
      return f(n);
    }

    return fmapMut(fnClone(r));
  }
}

var roseTreeFoldr         = deriveFoldr
  ((f, r) =>                pairsKV((_, v) => f(v), r.children)    );
var roseTreeFmapDeepPre   = deriveFmapDeepPre
  (roseTreeClone
  ,(f, r) => { r.children = fmapKV ((_, v) => f(v), r.children); } );
var roseTreeFmapDeepPost  = deriveFmapDeepPost
  (roseTreeClone
  ,(f, r) => { r.children = fmapKV ((_, v) => f(v), r.children); } );


function roseTreeFmapPreCont(f, r) {
  assert(r);
  function fmapMut(f2, n) {
    //console.log("fold deep ex fmap: ", n);
    return f2((f3) => {
      //console.log("Fold deep ex cont: ", f3);
      n.children = fmapKV((_, v) => fmapMut(f3, v), n.children);
    }, n);
  }
  return fmapMut(f, roseTreeClone(r));
}

// from vanilla d3.flameGraph
function hashString(name) {
  // Return a vector (0.0->1.0) that is a hash of the input string.
  // The hash is computed to favor early characters over later ones, so
  // that strings with similar starts have similar vectors. Only the first
  // 6 characters are considered.
  var hash = 0, weight = 1, max_hash = 0, mod = 10, max_char = 6;
  if (name) {
    for (var i = 0; i < name.length; i++) {
      if (i > max_char) { break; }

      hash      += weight * (name.charCodeAt(i) % mod);
      max_hash  += weight * (mod - 1);
      //weight    *= 0.70;
    }
    if (max_hash > 0) { hash = hash / max_hash; }
  }
  return hash;
}

function nameTrimModuleAndExtra(name) {
  name = name.replace(/.*`/, "");   // drop module name if present
  name = name.replace(/\(.*/, "");  // drop extra info
  return name;
}

function decimalisePercent(a, total, decimals) {
  if (total == 0) { a = 1; total = 1; }

  return Math.round((a / total) * Math.pow(10, 2+decimals)) / Math.pow(10, decimals)
}

function escapeHtml(s) {
  var m = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': '&quot;',
    "'": '&#39;',
    "/": '&#x2F;'
  };

  return String(s).replace(/[&<>"'\/]/g, (s) => m[s]);
}

// :: String -> Bool -> Percent
function colourFillRectCommon(strName, bHighlight, nPerc) {
  var funcSumPercScale    = d3.scale.pow().exponent(1)
                                    .domain([0, 1]).range ([0, 1]);
  if (bHighlight  ) return "#E600E6";
  
  var kBarLumin         = 85;
  var kBarChroma        = 100;
  var kJitterPerc       = 0.0;
  var jitter            = (base, p) => base - base * kJitterPerc * p;
nPerc = funcSumPercScale(nPerc);
  var nameHash  = hashString(nameTrimModuleAndExtra(strName))
    , clrLab    = d3.lab(jitter(kBarLumin , nameHash)
                        ,0, 85 * nPerc)
    , clrLhc    = d3.hcl(90 + (270 - 90) * nPerc
                        ,jitter(kBarChroma, nameHash)
                        ,kBarLumin)
    ;
  //console.log(fnPerc2, d.global.total);
  return clrLab;
}

function roseTreeFoldMerge(fnMkMapping, r) {
  assert(fnMkMapping && r);
  var fold = (mapFrameList, fnContinuation, n) => {
    var extRes  = fnMkMapping(mapFrameList, n)
      , mapFL   = extRes[0]
      , bFold   = extRes[1]
      , sibs    = mapFL[n.name].nodes
      ;
    //if (bFold) console.log("Folding: " + n.name, bFold);
    fnContinuation(curry(fold)(mapFL));

    if (!bFold) {
        return foldKV((a, _, v) => roseTreeMerge(a, v) 
                     ,n, sibs);
    } else {
        sibs.push(n);
        return undefined;
    }
  };

  return roseTreeFmapPreCont(curry(fold)({}), r);
}

function roseTreeFoldRecursiveDirect(r) {
  return roseTreeFoldMerge((mapFL, n) => {
      if (mapFL[n.name]) return [mapFL, true];
      
      var m = {};
      m[n.name]   = { nodes: [] };
      return [m, false];
  }, r);
}

function roseTreeFoldRecursiveFull(r) {
  return roseTreeFoldMerge((mapFL, n) => {
      if (mapFL[n.name]) return [mapFL, true];
      
      var m = Object.create(mapFL);
      m[n.name]   = { nodes: [] };
      return [m, false];
  }, r);
}

function roseTreeTrim(r) {
  return roseTreeFmapDeepPost((t) => {
    var trim = emptyObj(t.children) && (t.value == 0);
    //if (trim) console.log("trim:", t);
    return trim ? undefined : t;
  }, r);
}

function roseTreeSum(r) {
  return roseTreeFmapDeepPost((t) => {
    t.value = foldKV((a, _, v) => a + v.value
                    ,t.value, t.children);
    return t;
  }, r);
}

function roseTreeToArray(r) {
  return roseTreeFmapDeepPost((n) => {
    var a= toArray(n.children);
      n.children = a;
      return n;
    }, r);
}

function mkProperty(self, defVal, opt_fnOnChange) {
  var value = undefined;
  return function(_) {
    if (arguments.length === 0)
      return (value === undefined) ? defVal : value;

    value = _;
    if (opt_fnOnChange)
      opt_fnOnChange.call(self, _);

    return self;
  }
}

function displayName(s) {
  return s.replace(/.*`/, "");
}

function tooltipHtml(strName, nFrame, nFunc, nTotal) {
  return "name:  " + escapeHtml(strName) +
     "<br>frame: " + nFrame + " (" + decimalisePercent(nFrame , nFunc , 2) + "% of function weight)" +
     "<br>total: " + nFunc  + " (" + decimalisePercent(nFunc  , nTotal, 2) + "% of total weight)"
}

/*
for (var i = 100; i >= 0; i -= 5) {
  var n = 85;
  var p = i / 100;
  var c = colourFillRectCommon("", false, p);
  console.log(p, c.rgb());
}
//*/