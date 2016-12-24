# funkygraphs
(Originally developed late 2015 during my senior undergraduate year for a graduate course on information visualisation.)
Experiments with refinements of flame-graphs ('gold-plated'), and a complimentary variant ('funky') for visualising per-symbol information (aka per-function). This implementation was derived from [Martin Spier's d3-flame-graphs](https://github.com/spiermar/d3-flame-graph).

This repo contains:
- A d3 implementation of flame-graphs by [Martin Spier](https://github.com/spiermar/d3-flame-graph). (For comparison w/ gold-plated flame-graphs and funky-graphs.)
- A d3 implementation of gold-plated flame-graphs. (Improved flame-graphs.)
- A d3 implementation of funky-graphs. (Variant of flame-graphs for visualising per-symbol information.)
- An ad-hoc Lua 5.1 script for converting Firefox profiling information into a format usable by the above.
- Several data-sets from Firefox profile runs. (Both raw and processed-for-viewing.)
- A quick HTML page for viewing flame-graphs, gold-plated flame-graphs, and funky-graphs side by side.

![Imgur](http://i.imgur.com/J7iXSa3.png)
Gold-plated and funky-graph side by side. Hoving over a frame produces a popup with additional details and highlights frames belonging to the same function in both the gold-plated flame-graph and the funky-graph. Clicking a frame zooms into it for additional details.

![Imgur](http://i.imgur.com/bzTmiug.png)
A funky-graph zoomed in to a single function (`a.widget.bridger/a.fn[c]`). Invokers (and their stacks) are below it in blue; invokees are above it in yellow. The width of invokers/invokees is relative to their stack's weight.

## 1 - Disclaimer

This was a research/experimental project. As such, the code is somewhat messy, and has little to no consideration for performance. Funky-graphs in particularly are expensive to render on certain browsers (e.g. Firefox, though Chrome handles them fine) due to their O(n^2) number of visual elements. In practice, this could be handled by filtering/ignoring very small symbols.

## 2 - Quick Start
Install [Bower](http://bower.io/) using [npm](https://www.npmjs.com/):
```
$ npm install bower -g
```
Clone, build, and run:
```
$ git clone https://github.com/olivierhamel/funkygraphs.git
$ cd funkygraphs
$ npm install
$ bower install
$ gulp
```
By default it will open a browser window to a local page displaying a classic flame-graph (by [Martin Spier](https://github.com/spiermar/d3-flame-graph)), a gold-plated flame-graph, and a funky-graph, each loaded with the same data-set.

As noted above in Disclaimer, we recommend the use of Chrome for viewing funky-graphs.

## 3 - Quick Overview of the Visualisations
(For more details as to why and what, consult the project report's PDF.)

An introduction to flame-graphs by Brendan Gregg can be found [here](http://www.brendangregg.com/flamegraphs.html).
The following section provides an overview of flame-graphs, gold-plated flame-graphs, and funky-graphs.

Flame-graphs are designed for visualising sets of weighed symbol stacks. i.e. In Haskell:
```haskell
type Weight          = Double  -- [0, inf)
type Stack           = [Symbol]
type FlameGraphModel = MultiMap Stack Weight
-- or equivalently (once identical stacks are merged) --
-- 'weight' being the exclusive weight of that symbol,
type FlameGraphModel = [RoseTree (Symbol, Weight) FlameGraphModel]
```

However, classic flame-graphs have a number of issues. e.g.
- They do not provide good space-usage when confronted with recursive code. (i.e. Very tall stacks.)
    - In general they're rubish for visualising per-function information. (They're structured to display weighed stacks.)
- Terrible use of the colour channel: Colours are assigned based on the first few characters of the symbol.
- Interpreting the exclusive weight of a stack is done by visually substracting the layer above from that below. (TODO move this to future work, since we didn't get around to adding exclusive time markings.)
- The de-facto ordering of stacks in the graph (by symbol name) is entirely arbitrary and provides no advantages in interpreting the data.

The objective of this project was to solve these shortcomings. We developed two visualisations: Gold-plated flame-graphs, and funky-graphs.

### 3.1 - Gold-plated Flame-graphs
('Gold-plated' in the sense of being 'pretty' versions of flame-graphs.)

Gold-plated flame-graphs are a variant of classic flame-graphs with the following changes:
1)  Stack frames (a single line/block in the graph) are coloured in Lab space by their name (luminosity, optional), and their relative inclusive weight (b-axis).
2)  Recursive stacks frames are *folded*. (Both directly and indirectly recursive.)
3)  Sibling frames are sorted by inclusive weight.

The underlying data model is the same as a flame-graphs. (We use the rose-tree version.)


### 3.3 - Funky Graphs

**Func**tion **Hie**rarchy (func-hie -> funky) graphs are designed to visualise the relationship and properties of individual symbols in a weighed symbol stack. In other words, flame-graphs visualise weighed call-stacks; funky-graphs visualise weighed functions. They are complementary to, and intended to be used with, flame-graphs.

The underlying data model can be described by:
```haskell
data FuncData         = { func_weight     :: Weight
                        , func_calls      :: FlameGraphModel
                        , func_called_by  :: FlameGraphModel
                        }
type FunkyGraphModel  = Map Symbol FuncData
```
As can be seen by the data model, it is effectively two flame-graphs smashed together. In our implementation we use gold-plated flame-graphs. The invoker sub-flame-graph's colour b-axis is negated, shifting it to blue and making it distinct from invokees. Functions are sorted by largest inclusive-time, but are given an unzoomed relative width equal to their exclusive time. This encodes both heavy (high inclusive time) and expensive (high exclusive time) weights visually, and maintains the same ordering as a gold-plated flame-graph.


## 4 - Issues, Questions, Contributions

Bug, questions, discussions, etc, all go to [GitHub Issues](https://github.com/olivierhamel/funkygraphs/issues).
There are a number of known issues with the code. (e.g. Search-highlighting isn't implemented for funky-graphs, functions which are trimmed post fold (no children and no exclusive weight) don't appear in the funkygraph.

## 5 - Possible Future Improvements
- implement search highlighting for funky-graphs
- display fold-point-markings when hovering over a frame which has been folded (e.g. display 'ghost' frames?)
- display relative weight markings on callees when hovering over a caller in a funky-graph
- shift caller frames in a funky-graph so that common roots align at the bottom
- implement trimming or memorisation to deal with the O(n^2)-ness of funky-graphs
- add exclusive-weight colour & texture based markings to gold-plated flame-graph
- make the func bar in a funky-graph some other colour than callees (green, perhaps?)
- allow user-defined colour/highlights based on name patterns (e.g. highlight all libc as 'blue', bullet calls as 'orange', etc..)

## 6 - License
Portions of this repo (the classic flame-graph implementation and css) are copyrighted by Martin Spier and released under the Apache Licence, Version 2.

Copyright 2015 Olivier Hamel. All Rights Reserved.

Licensed under the BSD3. See `LICENCE` file for a copy of this licence.
This software is provided with absolutely no guarantees, and may or may not cause you to grow a sixth finger on your left hand.