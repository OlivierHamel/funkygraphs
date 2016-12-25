/*jshint esversion: 6 */
/*jshint laxcomma: true */

(function() {
  'use strict';

  function flameGraphEx() {

    var w           = 960   // graph width
      , h           = 540   // graph height
      , c           =  18   // cell height
      , selection   = null  // selection
      , tooltip     = true  // enable tooltip
      , title       = ""    // graph title
      , sort        = true  // function or boolean
      , transitionDuration  = 750
      , transitionEase      = "cubic-in-out" // tooltip offset
      , onZoom        = null
      , rootData    = null
      ;

    var tip = d3.tip()
      .direction("s")
      .offset([8, 0])
      .attr('class', 'd3-flame-graphEx-tip')
      .html((d) => tooltipHtml(d.name, d.value, d.global.funcs[d.name], d.global.total))
      ;

    var labelFormat = function(d) {
      return escapeHtml(d.name + " (" + d3.round(100 * d.dx, 3) + "%, " + d.value + " samples)");
    };

    function setDetails(t) {
      var details = document.getElementById("details");
      if (details)
        details.innerHTML = t;
    }

    function label(d) {
      if (!d.dummy) {
        return labelFormat(d);
      } else {
        return "";
      }
    }

    function name(d) {
      return displayName(d.name);
    }

    function generateHash(name) {
      // Return a vector (0.0->1.0) that is a hash of the input string.
      // The hash is computed to favor early characters over later ones, so
      // that strings with similar starts have similar vectors. Only the first
      // 6 characters are considered.
      var hash = 0, weight = 1, max_hash = 0, mod = 10, max_char = 6;
      if (name) {
        for (var i = 0; i < name.length; i++) {
          if (i > max_char) { break; }
          hash += weight * (name.charCodeAt(i) % mod);
          max_hash += weight * (mod - 1);
          weight *= 0.70;
        }
        if (max_hash > 0) { hash = hash / max_hash; }
      }
      return hash;
    }

    function colorHash(name) {
      // Return an rgb() color string that is a hash of the provided name,
      // and with a warm palette.
      var vector = 0;
      if (name) {
        name = name.replace(/.*`/, "");		// drop module name if present
        name = name.replace(/\(.*/, "");	// drop extra info
        vector = generateHash(name);
      }
      var r = 200 + Math.round(55 * vector);
      var g = 0 + Math.round(230 * (1 - vector));
      var b = 0 + Math.round(55 * (1 - vector));
      return "rgb(" + r + "," + g + "," + b + ")";
    }

    function augment(data) {
      // Augment partitioning layout with "dummy" nodes so that internal nodes'
      // values dictate their width. Annoying, but seems to be least painful
      // option.  https://github.com/mbostock/d3/pull/574
      if (data.children && (data.children.length > 0)) {
        data.children.forEach(augment);
        var childValues = 0;
        data.children.forEach(function(child) {
          childValues += child.value;
        });
        if (childValues < data.value) {
          data.children.push(
            {
              "name": "",
              "value": data.value - childValues,
              "dummy": true
            }
          );
        }
      }
    }

    function hide(d) {
      if(!d.original) {
        d.original = d.value;
      }
      d.value = 0;
      if(d.children) {
        d.children.forEach(hide);
      }
    }

    function show(d) {
      d.fade = false;
      if(d.original) {
        d.value = d.original;
      }
      if(d.children) {
        d.children.forEach(show);
      }
    }

    function getSiblings(d) {
      var siblings = [];
      if (d.parent) {
        var me = d.parent.children.indexOf(d);
        siblings = d.parent.children.slice(0);
        siblings.splice(me, 1);
      }
      return siblings;
    }

    function hideSiblings(d) {
      var siblings = getSiblings(d);
      siblings.forEach(function(s) {
        hide(s);
      });
      if(d.parent) {
        hideSiblings(d.parent);
      }
    }

    function fadeAncestors(d) {
      if(d.parent) {
        d.parent.fade = true;
        fadeAncestors(d.parent);
      }
    }

    function getRoot(d) {
      if(d.parent) {
        return getRoot(d.parent);
      }
      return d;
    }

    function zoom(chart, d) {
      if (onZoom) onZoom(d);
      tip.hide(d);
      hideSiblings(d);
      show(d);
      fadeAncestors(d);
      rootData = d;
      update(chart);
    }

    function searchTree(d, term) {
      var re = new RegExp(term),
          searchResults = [];

      function searchInner(d) {
        var label = d.name;

        if (d.children) {
          d.children.forEach(function (child) {
            searchInner(child);
          });
        }

        if (label.match(re)) {
          d.highlight = true;
          searchResults.push(d);
        } else {
          d.highlight = false;
        }
      }

      searchInner(d);
      return searchResults;
    }

    function clear(d) {
      d.highlight = false;
      if(d.children) {
        d.children.forEach(function(child) {
          clear(child, term);
        });
      }
    }

    function doSort(a, b) {
      if (typeof sort === 'function') {
        return sort(a, b);
      } else if (sort) {
        return d3.ascending(a.name, b.name);
      } else {
        return 0;
      }
    }

    function childWalk(f, d) {
      f(d);
      if (d.children)
        d.children.forEach(curry(childWalk)(f));
    }

    var partition = d3.layout.partition()
      .sort(doSort)
      .value(function(d) {return d.v || d.value;})
      .children(function(d) {return d.c || d.children;});

    function update(chart) {
      var x         = d3.scale.linear().range([0, w])
        , y         = d3.scale.linear().range([0, c])
        , fnClrFill = chart.colourFill()
        ;

      selection.each(function(data) {
        var nodes     = partition(data[0]);
        var kx        = w / data[0].dx;

        //console.log(rootData);
        var globalEx  = Object.create(data[1]);
        globalEx.largest = globalEx.total;
        if (rootData) {
          globalEx.largest  = rootData.value;
          /*
          globalEx.largest  = (rootData.depth == 0)
                            ? foldKV((s, _, v) => Math.max(s, v.value), 0, rootData.children)
                            : rootData.value;
          //*/
        }
        //console.log(globalEx);

        pairsKV((_, v) => { v.global = globalEx; }
               ,nodes);

        var svg       = d3.select(this).select("svg")
          , widthCalc = function(d) { return d.dx * kx; }
          , g         = svg.selectAll("g")
                            .data(nodes.filter(function(d) { return widthCalc(d) > 0.1; }));
        //console.log("update: ", data, selection, this, nodes);
        g//*
          .transition()
          .duration(transitionDuration)
          .ease(transitionEase)//*/
          .attr("transform", function(d) { return "translate(" + x(d.x) + "," + (h - y(d.depth) - c) + ")"; });

        g.select("rect")//*
          .transition()
          .duration(transitionDuration)
          .ease(transitionEase)//*/
          .attr("width", widthCalc);

        var node = g.enter()
          .append("svg:g")
          .attr("transform", function(d) { return "translate(" + x(d.x) + "," + (h - y(d.depth) - c) + ")"; });

        node.append("svg:rect")
          .attr("width", function(d) { return d.dx * kx; });

        if (!tooltip)
          node.append("svg:title");

        node.append("foreignObject")
          .append("xhtml:div");

        g .attr("width" , function(d) { return d.dx * kx; })
          .attr("height", function(d) { return c; })
          .attr("name"  , function(d) { return d.name; })
          .attr("class" , function(d) { return d.fade ? "frame fade" : "frame"; });

        g .select("rect")
            .attr ("height"     , function(d) { return c; })
            .attr ("fill"       , fnClrFill)
            .style("visibility" , function(d) { return d.dummy ? "hidden" : "visible"; });

        if (!tooltip)
          g.select("title")
            .text(label);

        g .select("foreignObject")
            .attr ("width"  , function(d) { return d.dx * kx; })
            .attr ("height" , function(d) { return c; })
          .select("div")
            .attr ("class"  , "label")
            .style("display", function(d) { return (d.dx * kx < 35) || d.dummy ? "none" : "block";})
            .text (name);

        g.on('click', curry(zoom)(chart));



        g.exit().remove();

        g.on('mouseover', function(d) {
          if (d.dummy) return;

          if (tooltip) tip.show(d);

          var fn = chart.onHoverBgn();
          if (fn) fn(chart, d);

          setDetails(label(d));
        }).on('mouseout', function(d) {
          if (d.dummy) return;

          if (tooltip) tip.hide(d);

          var fn = chart.onHoverEnd();
          if (fn) fn(chart, d);

          setDetails("");
        });
      });
    }

    function chart(s, d) {
      if (!arguments.length) return chart;

      var pseudoRoot  = { name     : ""
                        , root     : true
                        , value    : 0
                        , children : fmapKV((_, v) => roseTreeFoldRecursiveFull(v)
                                           ,d)
                        };
      var rootFolded  = roseTreeSum(roseTreeFoldRecursiveFull(pseudoRoot));
      var global      = { funcs   : roseTreeFoldr((s, v) => {
                            if (!s[v.name]) s[v.name] = 0;
                            s[v.name] += v.value;
                            return s;
                          }, {}, rootFolded)
                        , total   : rootFolded.value
                        };

      var aryRoot = roseTreeToArray(roseTreeTrim(roseTreeSum(pseudoRoot)));
      assert(aryRoot);

      selection = s;
      selection.datum([aryRoot, global]);
      selection.each(function(data) {
        data = data[0];

        var svg = d3.select(this)
          .append("svg:svg")
          .attr("width", w)
          .attr("height", h)
          .attr("class", "partitionEx d3-flame-graphEx")
          .call(tip);

        svg.append("svg:text")
          .attr("class", "title")
          .attr("text-anchor", "middle")
          .attr("y", "25")
          .attr("x", w/2)
          .attr("fill", "#fff")
          .text(title);

        augment(data);

        // "creative" fix for node ordering when partition is called for the first time
        partition(data);

        // invoke any onZoom, and trigger first draw
        resetZoom(data);
      });
    }
    var prop  = (defVal, fnOnChange) => mkProperty(chart, defVal, fnOnChange);

    function selectNodeByFilter(fn) {
      return selection.selectAll("svg g")
                      .filter(fn);
    }

    function selectNodeByName(strName) {
      return selectNodeByFilter((d) => d.name === strName);
    }

    chart.height = function (_) {
      if (!arguments.length) { return h; }
      h = _;
      return chart;
    };

    chart.width = function (_) {
      if (!arguments.length) { return w; }
      w = _;
      return chart;
    };

    chart.cellHeight = function (_) {
      if (!arguments.length) { return c; }
      c = _;
      return chart;
    };

    chart.tooltip = function (_) {
      if (!arguments.length) { return tooltip; }
      if (typeof _ === "function") {
        tip = _;
      }
      tooltip = true;
      return chart;
    };

    chart.title = function (_) {
      if (!arguments.length) { return title; }
      title = _;
      return chart;
    };

    chart.transitionDuration = function (_) {
      if (!arguments.length) { return transitionDuration; }
      transitionDuration = _;
      return chart;
    };

    chart.transitionEase = function (_) {
      if (!arguments.length) { return transitionEase; }
      transitionEase = _;
      return chart;
    };

    chart.sort = function (_) {
      if (!arguments.length) { return sort; }
      sort = _;
      return chart;
    };

    chart.colourFill = prop((d) => {
        if (d.dummy ) return "rgb(255, 0, 255)";

        var nPerc = Math.min(d.global.funcs[d.name] / d.global.largest, 1);
        return colourFillRectCommon(d.name, d.highlight, nPerc);
      });

    chart.label = function(_) {
      if (!arguments.length) { return labelFormat; }
      labelFormat = _;
      return chart;
    };

    chart.search = function(term) {
      var searchResults = [];
      selection.each(function(data) {
        searchResults = searchTree(data[0], term);
        update(chart);
      });
      return searchResults;
    };

    chart.clear = function() {
      selection.each(function(data) {
        clear(data[0]);
        update(chart);
      });
    };

    chart.onZoom = function(_) {
      if (!arguments.length) { return onZoom; }
      onZoom = _;
      return chart;
    };

    chart.zoomTo = function(d) {
      zoom(chart, d);
    };

    chart.resetZoom = function() {
      selection.each(function (data) {
        zoom(chart, data[0]); // zoom to root
      });
    };

    chart.outlineName = function(strName, bEnable) {
      var kBase = "d3-flame-graphEx frame";

      selectNodeByName(strName)
        .attr("class", (d) => kBase + (bEnable ? " outline"  : "")
                                    + (d.fade  ? " fade"     : "")
             )
        ;
      return chart;
    };

    chart.onHoverBgn  = prop(null);
    chart.onHoverEnd  = prop(null);

    return chart;
  }

  if (typeof module !== 'undefined' && module.exports){
		module.exports = flameGraphEx;
	}
	else {
		d3.flameGraphEx = flameGraphEx;
	}
})();
