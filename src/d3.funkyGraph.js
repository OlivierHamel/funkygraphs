(function() {
  'use strict';

  /*
   * type FrameId     = String                    -- concat list of all parent frames
   * type FuncMap     = Map String Func           -- key = func's name
   * 
   * data FuncTree a = FuncTree
   *   { func       :: a
   *   , children   :: Map String FuncTree        -- key = func's name
   *   }
   * 
   * data FuncBiTree a = FuncBiTree
   *   { func       :: Func
   *   , calls      :: Map String FuncTree        -- key = func's name
   *   , calledBy   :: Map String FuncTree        -- key = func's name
   *   }
   * 
   * data Func        = Func
   *   { name       :: String
   *   , value      :: Number             -- weight, not necessarily sum of frames (e.g. parent frame [below func line] is always = to sum, but child frames [>= func line] can be >= due to exclusive weight)
   *   , frames     :: [Frame]            -- frames belonging to it, but not necessarily ALL of its frames
   *   , id         :: String             -- redundant, derived from parent's funcId + "|" + our func's name (cached for perf)
   *   }
   * 
   * data Frame       = Frame
   *   { func       :: Func               -- top-most Func desc (the one which knows all of its frames)
   *   , value      :: Number             -- weight (exclusive + sum children), specific to the sub-func being inspected.
   *   , children   :: Map String Frame   -- key = frame's func's name
   *   , rawFrame   :: RawFrame
   *   }
   */

  /*
  var Func        = I.Record( { id        : null
                              , name      : null
                              , frames    : I.List() // Frame
                              });
  var Frame       = I.Record( { value     : 0
                              , valueExcl : 0
                              , children  : I.Map() // Map String Frame
                              , rawFrame  : null
                              });
  var FuncTree    = I.Record( { func      : null
                              , children  : I.Map() // Map String FuncTree
                              });
  var FuncBiTree  = I.Record( { func      : null
                              , calls     : I.Map() // Map String FuncTree
                              , calledBy  : I.Map() // Map String FuncTree
                              });
  */

  // [[a]] -> [a]
  var flattenAry  = curry(foldKV)((s, _, v) => s.concat(v), []);
  var copyShallow = (o) => fmapKV((_, v) => v, o);

  // :: (Traversable f, Functor f) => f a -> [a]
  function toSortedAry(fnSorter, f) {
    var a = toArray(f);
        a.sort(fnSorter);
    return a;
  }

  // :: (Traversable f, Functor f) => f FuncTree -> Number
  function funcTreeKidsWeight(kids) {
    return foldKV((s, _, v) => s + v.func.value, 0, kids);
  }

  // :: (a -> Func -> a) -> a -> Func -> Map String FuncTree -> a
  function foldFuncTreePost(fnFold, z, func, kids) {
    var s2 = foldKV((s, _, v) => foldFuncTreePost(fnFold, s, v.func, v.children)
                   ,z, kids);
    return fnFold(s2, func);
  }

  function pairsFuncTreePost(fn, func, kids) {
    pairsKV((_, v) => pairsFuncTreePost(fn, v.func, v.children)
           ,kids);
    fn(func, kids);
  }

  function pairsFuncTreePre(fn, func, kids) {
    fn(func, kids);
    pairsKV((_, v) => pairsFuncTreePre(fn, v.func, v.children)
           ,kids);
  }

  // :: [RawFrame] -> (Map String FuncBiTree, Num)
  function funkify(rootFrames) {
    rootFrames  = fmapKV((_, v) => roseTreeFoldRecursiveDirect(v)
                        ,rootFrames);

    // :: [RawFrame] -> (Map String   [RawFrame]
    //                  ,Map RawFrame  RawFrame )
    function accumFuncsAndParents(rootFrames) {
      var fold    = (f, z) => foldKV((s, _, r) => roseTreeFoldr(f, s, r)
                                    ,z, rootFrames);

      // :: Map RawFrame RawFrame
      var raw2ParentRaw   = fold((m, n) => {
          pairsKV((_, v) => { assert(!m.has(v));
                              m = m.set(v, n); }
                 ,n.children);
          return m;
        }, Immutable.Map());

      var funcFrames      = fold((s, n) => {
          if (!s[n.name]) s[n.name] = [];
          s[n.name].push(n);
          return s;
        }, {});

      return [funcFrames, raw2ParentRaw];
    }

    // :: (Map String   [RawFrame]
    //    ,Map RawFrame  RawFrame ) -> Map String FuncBiTree
    function genRoots(pair) {
      var mapRawFrames = pair[0];
      var mapRawParent = pair[1]; // \note only usable for FUNC-root-raw-frames!

      // :: Map String Frame -> Map String Frame -> Map String Frame
      function mergeFrames(a, b) {
        if (emptyObj(a)) return b;
        if (emptyObj(b)) return a;
        
        var t = copyShallow(a);
        pairsKV((k, v) => {
          t[k] = t[k] ? mergeFrame(t[k], v) : v;
        }, b);
        return t;
      }

      function mergeFrame(a, b) {
        //if (!a.rawFrame) console.log(a);
        assert(a.isFrame);
        assert(b.isFrame);
        assert(a.rawFrame);
        assert(b.rawFrame);
        return { value     : a.value     + b.value
               , valueExcl : b.valueExcl + b.valueExcl
               , children  : mergeFrames(a.children, b.children)
               , rawFrame  : a.rawFrame
               , isFrame   : true
               };
      }

      // :: IMap String [RawFrame] -> RawFrame -> RawFrame -> Maybe Frame
      var counterThing = 0;
      function foldRawFrame(mapSibs, rawFrame, rawFrameRoot) {
        var lookup    = mapSibs[rawFrame.name];
        var bFold     = !!lookup;
        if (!bFold) {
          mapSibs = Object.create(mapSibs);//.set(rawFrame.name, lookup);
          mapSibs[rawFrame.name] = { mapSibs  : mapSibs
                                   , aryFolded: [] };
          lookup  = mapSibs[rawFrame.name];
        } //else if (rawFrame.name == rawFrameRoot.name)
          //return undefined;

        assert(lookup);
        counterThing += 1;
        if (counterThing > 100)
          console.log("enter", counterThing);
        lookup.aryFolded.push({ raw : rawFrame
                              , kids: fmapKV((_, v) => foldRawFrame(lookup.mapSibs, v, rawFrameRoot)
                                            ,rawFrame.children)
                              });
        counterThing -= 1;
        if (counterThing >= 100)
          console.log("exit", counterThing);
        if (bFold) return undefined;

        //console.log("accum: " + rawFrame.name, lookup.aryFolded);
        assert(lookup.aryFolded.length > 0);
        var allRawFrames  = fmapKV((_, v) => v.raw, lookup.aryFolded);
        //console.log("---------------");
        var mapKidFrames  = foldKV((s, _, v) => mergeFrames(s, v)
                                  ,{}, fmapKV((_, v) => v.kids, lookup.aryFolded));

        var weightKids    = foldKV((s, _, v) => s + v.value, 0, mapKidFrames);
        var weightExcl    = foldKV((s, _, v) => s + v.value, 0, allRawFrames);
        var weightTotal   = weightKids + weightExcl;
        if (weightTotal == 0) return undefined;

        //console.log(rawFrame.name, weightExcl, weightKids, weightTotal);
        assert(rawFrame);
        return           ({ value     : weightTotal
                          , valueExcl : weightExcl
                          , children  : mapKidFrames
                          , rawFrame  : rawFrame
                          , isFrame : true
                          });
      }

      // :: String -> String -> [Frame] -> FuncTree
      function mkFuncTree(idSplit, prevId, name, frames) {
        var id        = prevId + idSplit + name;
        var func      =          ({ id    : id
                                  , name  : name
                                  , value : foldKV((s, _, v) => s + v.value, 0, frames)
                                  , frames: frames
                                  });
        // :: Map String Frame
        var arySubFrames  = fmapKV((_, v) => v.children, frames);
        //pairsKV((_, v) => { pairsKV((_, v) => {console.log(v); assert(v.isFrame);}, v); }, arySubFrames);//console.log(arySubFrames)
        var subFrames     = foldKV((s, _, v) => mergeFrames(s, v)
                                  ,{}, arySubFrames);
        //console.log("frames: ", subFrames);
        return          (
          { func    : func
          , children: fmapKV((n, v) => mkFuncTree(idSplit, id, n, [v])
                            ,subFrames)
          });
      }

      // :: RawFrame -> RawFrame
      function mkParentRoseTree(rawFrame, frameVal) {
        assert(rawFrame);
        function go(fOriginal) {
          if (!fOriginal) return;

          var frame   = { name    : fOriginal.name
                        , value   : 0
                        , children: {}
                        };
          var frameP  = go(mapRawParent.get(fOriginal));
          if (frameP) frame.children[frameP.name] = frameP;
          else        frame.value                 = frameVal;

          return frame;
        }
        return go(rawFrame);
      }

      function rawFrameInSelf(f) {
        function go(x) {
          var p = mapRawParent.get(x);
          if (!p                ) return false;
          if (p.name === f.name ) return true;
          return go(p);
        };
        return go(f);
      };

      // :: Map String FuncBiTree
      return fmapKV((strName, rawFrames) => {
          // Ignore any recursive frames
          var rawFramesDirect = filterKV((_, v) => rawFrameInSelf  (v), rawFrames);
          // :: [RawFrame] -> [Frame]
          var cookFrames      = (f) => fmapKV((_, v) => foldRawFrame({}, v, v), f);
          var tree            = (split, frames) => mkFuncTree(split, "", strName, cookFrames(frames));
          // Filter any raw frame which has an eventual parent who's in this set of frames
          var treeCalls       = tree("|+++|", rawFramesDirect);
          // Create a pseudo-RawFrame tree for parents
          var treeCalledBy    = tree("|---|"
                                    ,fmapKV((_, v) => mkParentRoseTree(v.rawFrame, v.value)
                                           ,treeCalls.func.frames));
/*
          console.log(treeCalls.func
                     ,treeCalls.func.name, treeCalls.func.value
                     ,treeCalledBy.func.name, treeCalledBy.func.value);
          */
          return               ({ func    : treeCalls   .func
                                , calls   : treeCalls   .children
                                , calledBy: treeCalledBy.children });
        }, mapRawFrames);
    }

    var totalWeight = foldKV((s, _, v) => s + roseTreeSum(v).value, 0, rootFrames);
    return [genRoots(accumFuncsAndParents(rootFrames)), totalWeight];
  }

  // takes the return value of funkify and flattens it for d3's stupid non-recursive nature and
  // determines the layout for a flattened listing
  // 
  // data GlobalInfo = GlobalInfo
  //   { funcs    :: Map String FuncBiTree
  //   , total    :: Number
  //   , largest  :: Number
  //   }
  // data FuncNode = FuncNode
  //   { pos      :: Position, size :: Size, info :: Func
  //   , calls    :: [FuncNode]
  //   , calledBy :: [FuncNode]
  //   , global   :: GlobalInfo
  //   }
  // 
  // :: Sorter -> RowHeight -> Width -> Height -> (Map String FuncBiTree, Number) -> [FuncNode]
  function funkifyFlattenAndLayout(nRowHeight, nWidth, nHeight, mapFuncBiTreeAll, pair) {
    // JS wants < 0 for before, == 0 eq, > 0 after
    // :: (x -> Num) -> { x | { func :: Func } } -> { x | { func :: Func } } -> Num
    var fnSorter        = (f) => (a, b) => {
        var a1 = f(a);
        var b1 = f(b);
        //if (a1 == b1 || a1 > 100 || b1 > 100) console.log(a1, b1);
        //console.log(a1 < b1);
        if (a1 != b1) return d3.descending(a1, b1);
        //console.log(a.func.name < b.func.name);
        return d3.ascending(a.func.name, b.func.name);
      };
    var mapFuncBiTree   = filterKV((_, v) => v.func.value == 0, pair[0]);
    var totalWeight     = pair[1];
    var kHackyWidthMin  = 0.1;
    var global          = { funcs   : mapFuncBiTreeAll
                          , total   : totalWeight
                          , largest : foldKV((s, _, v) => Math.max(s, v.func.value), 0, mapFuncBiTree)
                          };

    // :: (Traversable f, Functor f) => Num -> Num -> f Num -> (f Num, Num)
    function scaleF(width, extra, f) {
      assert(width > 0);
      var total = foldKV((s, _, v) => s + v, extra, f);
      if (total <= 0) console.log(width, extra, f);
      //assert(total > 0);
      var scale = (total > 0) ? width / total : 0;
      return [fmapKV((_, v) => v * scale, f), extra * scale];
    }

    // :: (Traversable f, Functor f, a :: { func :: Func }) => PosW -> Num -> f Num -> f PosW
    function calcPosW(aryPosW, nExtra, f) {
      var widths = scaleF(aryPosW[2], nExtra, f);
      var lefts  = foldKV((s, _, v) => { s.push(s[s.length - 1] + v); return s; }
                         ,[aryPosW[1] + widths[1]], widths[0]);
      return fmapKV((k, v) => [aryPosW[0], lefts[k], v], widths[0]);
    }

    // type PosW = (Top, Left, Width)
    // :: PosW -> Func -> [FuncNode] -> [FuncNode] -> FuncNode
    function entry(bAbove, aryPosW, func, calls, calledBy) {
      assert(aryPosW[2] == aryPosW[2]);
      return  { pos     : [aryPosW[1] , aryPosW[0]  ]
              , size    : [aryPosW[2] , nRowHeight  ]
              , func    : func
              , calls   : calls
              , calledBy: calledBy
              , global  : global
              , above   : bAbove
              };
    }

    // :: (Traversable f, Functor f, a :: { func :: Func }) =>
    //    OffsetRowY -> LayoutSubTree -> LayoutSubTree ->
    //    PosW -> a -> f FuncTree -> [FuncNode]
    function layoutTree(bAbove, aryPosW, x, kids) {
      assert(aryPosW);
      var recurse       = curry(layoutTree)(bAbove);
      // :: PosW -> FuncTree -> [FuncNode]
      function layout(aryPosW, funcTree) {
        if (aryPosW[2] <= kHackyWidthMin) return [];
        assert(aryPosW);
        var aryKids     = bAbove ? recurse(aryPosW, funcTree, funcTree.children) : [];
        var aryParents  = bAbove ? [] : recurse(aryPosW, funcTree, funcTree.children);
        var treeEntry   = entry(bAbove, aryPosW, funcTree.func, aryKids, aryParents);
        return flattenAry([aryKids, aryParents, [treeEntry]]);
      }

      var nWeightExcl   = x.func.value - funcTreeKidsWeight(kids);
      if (nWeightExcl < 0) console.log(nWeightExcl, x);
      assert(nWeightExcl >= 0);
      var subTreeWeight = (v) => v.func.value;
      var aryKidsSorted = toSortedAry(fnSorter(subTreeWeight), kids);
      var aryPosW2      = fmapKV((k, v) => (k == 0) ? (v + (bAbove ? -nRowHeight : nRowHeight)) : v
                                ,aryPosW);
      var aryPosWKids   = calcPosW(aryPosW2, nWeightExcl
                                  ,fmapKV((_, v) => subTreeWeight(v), aryKidsSorted));
      return flattenAry(fmapKV((k, v) => layout(aryPosWKids[k], v), aryKidsSorted));
    }

    // :: (Traversable f, Functor f, a :: { func :: Func }) =>
    //    PosW -> a -> f FuncTree -> [FuncNode]
    var layoutTreeChild   = curry(layoutTree)(true );
    var layoutTreeParent  = curry(layoutTree)(false);

    // [FuncBiTree] -> [FuncNode]
    function layoutBiTrees(mapFuncBiTree) {
      function calledByDepth(funcs) {
        return foldKV((s, _, v) => Math.max(s, 1 + calledByDepth(v.children))
                     ,0, funcs);
      }

      // :: PosW -> FuncBiTree -> [FuncNode]
      function layoutBiTree(aryPosW, biTree) {
        if (aryPosW[2] <= kHackyWidthMin) return [];
        var aryKids     = layoutTreeChild (aryPosW, biTree, biTree.calls   );
        var aryParents  = layoutTreeParent(aryPosW, biTree, biTree.calledBy);
        var biTreeEntry = entry(true, aryPosW, biTree.func, aryKids, aryParents);
        return flattenAry([aryKids, aryParents, [biTreeEntry]]);
      }

      var rootWeight  = (v) => 1 + (v.func.value - funcTreeKidsWeight(v.calls));
      var biTrees     = toSortedAry(fnSorter((v) => v.func.value), mapFuncBiTree); //:: [FuncBiTree]
      var bLone       = (biTrees.length == 1);
      var posY        = Math.round(bLone  ? nHeight - nRowHeight * (2 + calledByDepth(biTrees[0].calledBy))
                                          : ((nHeight - nRowHeight) / 2))
      var biTreePosW  = calcPosW([posY, 0, nWidth], 0
                                ,fmapKV((_, v) => rootWeight(v), biTrees));

      return flattenAry(fmapKV((k, v) => layoutBiTree(biTreePosW[k], v)
                              ,biTrees));
    }
    
    return layoutBiTrees(mapFuncBiTree);
  }

  function colourFillRect(d) {
    var fnSum     = d.global.funcs[d.func.name].func.value
      , fnPerc    = Math.min(fnSum / d.global.largest, 1)
      , fnPerc2   = fnPerc * (d.above ? 1 : -1)
      ;
    return colourFillRectCommon(d.func.name, d.highlight, fnPerc2);
  }

  function dataBind(chart, svg, funkyData) {
    //console.log(chart.sort(), chart.cellHeight(), chart.width(), chart.height(), funkyData);
    var funcFilter   = chart.filter() || ((_) => false);
    var dataFiltered = [filterKV(funcFilter, funkyData[0])
                       ,funkyData[1]
                       ];
    
    var nodes   = funkifyFlattenAndLayout(chart.cellHeight(), chart.width(), chart.height(), funkyData[0], dataFiltered);
    var g       = svg .selectAll("g")
                      .data(nodes, (d) => d.func.id);

    g
      .transition()
      .duration(chart.transitionDuration())
      .ease(chart.transitionEase())//*/
      .attr("transform" , (d) => { return "translate(" + d.pos[0] + ", " + d.pos[1] + ")"; });

    g.select("rect")
      .transition()
      .duration(chart.transitionDuration())
      .ease(chart.transitionEase())
      .attr("width", (d) => d.size[0]    );

    var gNew    = g .enter()
                    .append("svg:g");

    gNew.append("svg:rect")
        ;
    //gNew.append("svg:text")
    gNew.append("foreignObject")
          .append("xhtml:div")
        ;

    g .attr("width"     , (d) => d.size[0]    )
      .attr("height"    , (d) => d.size[1]    )
      .attr("name"      , (d) => d.func.name  )
      .attr("class"     , (d) => d.fade ? "frame fade" : "frame")
      .attr("transform" , (d) => { return "translate(" + d.pos[0] + ", " + d.pos[1] + ")"; })
      ;

    g .exit()
      .remove();

    g .select("rect")
        .attr ("width"      , (d) => d.size[0])
        .attr ("height"     , (d) => d.size[1])
        .attr ("fill"       , colourFillRect)
        .style("visibility" , (d) => d.dummy ? "hidden" : "visible")
      ;

    /*
    var kPadding = 2;
    function wrap(d) {
        var self        = d3.select(this);
        var width       = d.size[0] - 2 * kPadding;
        var txtWhole    = self.text();
        function binSearch() {
          //console.log(txtWhole);
          function rec(nMin, nMax) {
            if ((nMin + 1) >= nMax) return txtWhole.slice(0, nMin + 1);

            var nMid = nMin + Math.ceil((nMax - nMin) / 2);
            //console.log(nMin, " <= ", nMid, "<=", nMax);
            self.text(txtWhole.slice(0, nMid));
            
            var txtVisLen = self.node().getComputedTextLength();
            if (txtVisLen <= width) {
              return rec(nMid, nMax);
            } else {
              return rec(nMin, nMid);
            }
          }

          return rec(0, txtWhole.length);
        }
        
        var text        = binSearch();
        self.text(text);
        var textLength  = self.node().getComputedTextLength();
        while (textLength > width && text.length > 0) {
            text = text.slice(0, -1);
            self.text(text + '…');
            textLength = self.node().getComputedTextLength();
        }
    } 
    g .select("text")
        .attr ("transform"  , (d) => { return "translate(" + kPadding + ", " + (d.size[1] - 5) + ")"; })
        .attr ("width"      , (d) => d.size[0]  )
        .attr ("height"     , (d) => d.size[1]  )
        .attr ("text-anchor", "start")
        .attr ("class"      , "label")
        .style("display"    , (d) => ((d.size[0] < 15) || d.dummy) ? "none" : "block")
        .text ((d) => displayName(d.func.name))
        .each(wrap)
      ;
    */
    g .select("foreignObject")
        .attr ("width"      , (d) => d.size[0]  )
        .attr ("height"     , (d) => d.size[1]  )
        .select("div")
          .attr ("class"      , "label")
          .style("display"    , (d) => ((d.size[0] < 35) || d.dummy) ? "none" : "block")
          .text ((d) => displayName(d.func.name))
      ;

    g.on('click', (d) => {
      var fn = chart.onClick();
      if (fn) fn(chart, d);
    });

    g.on('mouseover', function(d) {
      if (d.dummy) return;

      var tooltip = chart.tooltip();
      if (tooltip) tooltip.show(d);

      var fn = chart.onHoverBgn();
      if (fn) fn(chart, d);
    }).on('mouseout', function(d) {
      if (d.dummy) return;

      var tooltip = chart.tooltip();
      if (tooltip) tooltip.hide(d);

      var fn = chart.onHoverEnd();
      if (fn) fn(chart, d);
    });

    
  }
  
  function funkyGraph() {
    var funkyData   = null; //:: Map String FuncBiTree
    var svg         = null; //:: D3Selection
    var chart       = function(s, d) {
      if (!arguments.length) return chart;

      assert(s && d);
      funkyData = funkify(d);
      svg       = s.append("svg:svg")
                   .attr("width" , chart.width ())
                   .attr("height", chart.height())
                   .attr("class" , "partitionEx d3-funky-graph")
                   .call(chart.tooltip());

      svg .append("svg:text")
          .attr("class"       , "title")
          .attr("text-anchor" , "middle")
          .attr("y"           , "25")
          .attr("x"           , chart.width() / 2)
          .attr("fill"        , "#fff")
          .text(chart.title());

      fnRedraw();
      return chart;
    };

    var prop        = (defVal, fnOnChange) => mkProperty(chart, defVal, fnOnChange);
    var fnRedraw    = function(_) { if (svg && funkyData) dataBind(chart, svg, funkyData); };

    function selectNodeByFilter(fn) {
      return svg.selectAll("g")
                .filter(fn);
    }

    function selectNodeByName(strName) {
      return selectNodeByFilter((d) => d.func.name === strName);
    }

    chart.title               = prop("");
    chart.width               = prop(960, fnRedraw);
    chart.height              = prop(540, fnRedraw);
    chart.cellHeight          = prop(18 , fnRedraw);
    chart.transitionDuration  = prop(750);
    chart.transitionEase      = prop("cubic-in-out");
    chart.filter              = prop(null, fnRedraw);
    chart.tooltip             = prop((() => {
        return d3 .tip()
                  .direction("s")
                  .offset([8, 0])
                  .attr('class', 'd3-funky-graph-tip')
                  .html((d) => tooltipHtml(d.func.name, d.func.value, d.global.funcs[d.func.name].func.value, d.global.total))
                  ;
      })());

    chart.resetZoom   = function() { chart.filter(null); return chart; };
    chart.outlineName = function(strName, bEnable) {
      selectNodeByName(strName)
        .attr("class", bEnable ? "d3-funky-graph outline"
                               : "d3-funky-graph")
        ;
      return chart;
    }

    chart.onHoverBgn  = prop(null);
    chart.onHoverEnd  = prop(null);
    chart.onClick     = prop((_, d) => {
        chart.filter((name, _) => name !== d.func.name);
      });
    
    chart.search = function(term) {
      var searchResults = [];
      // TODO: Implement
      return searchResults;
    };

    chart.clear = function() {
      // TODO: Implement
    };

    return chart;
  }

  if (typeof module !== 'undefined' && module.exports){
    module.exports  = funkyGraph;
  } else {
    d3.funkyGraph   = funkyGraph;
  }
})();

