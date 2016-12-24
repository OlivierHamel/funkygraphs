local js = require("dkjson")

local function FileRead(strName)
    local f = io.open(strName, "r")
    local s = f:read()
    f:close()
    return s
end

local function FileWrite(strName, s)
    local f = io.open(strName, "w")
    f:write(s)
    f:close()
end

function table.foldKV(f, z, t)
    local s = z
    for k, v in pairs(t) do s = f(k, v, s) end
    return s
end

function table.fmapKV(f, t)
    local t2 = {}
    for k, v in pairs(table.copyShallow(t)) do
        t2[k] = f(k, v)
    end
    return t2
end

function table.mergeInto(a, b) -- merges b into a
    local bOverride = false
    for k, v in pairs(table.copyShallow(b)) do
        bOverride = bOverride or (a[k] ~= nil)
        a[k] = v
    end
    return bOverride
end

function table.reverse(ary)
    local t = {}
    for k, v in ipairs(ary) do
        t[1 + #ary - k] = v
    end
    return t
end

function table.copyShallow(t)
    local t2 = {}
    for k, v in pairs(t) do t2[k] = v end
    return t2
end

local function StackSelectSrcNames(aryStk)
    local t = {}
    for k, v in ipairs(aryStk) do
        local srcTrimed = v.source:match("[^/]-$")
        local srcTrimed2 = srcTrimed:match("^(.-%.js)") or ""
        if not srcTrimed2 then print( srcTrimed) end
        local srcFunc   = v.functionDisplayName or (v.line and ("line " .. v.line)
                                                           or  tostring(v):match("%S+$"))
        t[k] = srcTrimed2 .. "`" .. srcFunc
    end
    return t
end

local function StackMerge(tblStks, aryStk)
    local tblFrame = tblStks
    for _, v in ipairs(aryStk) do
        if not tblFrame[v] then tblFrame[v] = {} end
        tblFrame = tblFrame[v]
    end
    tblFrame[0] = (tblFrame[0] or 0) + 1
end

local function StackMergeToJsonPre(tblStacks, strName)
    local tblEntry  = { name  = strName
                      , value = tblStacks[0] or 0
                      }
    for k, v in pairs(tblStacks) do
        if k ~= 0 then
            if not tblEntry.children then tblEntry.children = {} end
            
            local tblChild = StackMergeToJsonPre(v, k)
            assert(not tblEntry.children.name)
            tblEntry.children[tblChild.name] = tblChild
        end
    end
    
    return tblEntry
end


local function StackJsonFold(tblStk)
    local function lookupExtend(mapFL, n)
        if mapFL[n.name] then return mapFL, true end
        
        local m           = { }
              m[n.name]   = { mapFL     = mapFL
                            , nodes     = {} }
        setmetatable(m, m)
        return m, false
    end
    
    local function mergeNodes(a, b) -- merges b into a
        --print("Merge: ", a.name, a, b)
        assert(a ~= b)
        assert(a.name == b.name)
        a.value = a.value + b.value
        if not a.children then
            a.children = b.children
        elseif b.children then
            for k, v in pairs(b.children) do
                a.children[k] = a.children[k] and mergeNodes(a.children[k], v)
                                              or  v
            end
        end
        return a
    end
    
    local function foldNode(mapFrameList, n)
        local mapFL, bFold  = lookupExtend(mapFrameList, n)
        local sibs          = mapFL[n.name].nodes
        
        n.children = table.fmapKV(function(_, v)
            return foldNode(mapFL, v)
        end, n.children or {})
        
        if not bFold then
            return table.foldKV(function(_, v, a) return mergeNodes(a, v) end
                               ,n, sibs)
        else
            sibs[#sibs + 1] = n
            return nil
        end
    end

    return foldNode({}, tblStk)
end

local function StackJsonSum(tblStks)
    local function go(t)
        if not t.children then return end
        for k, v in pairs(t.children) do
            go(v)
            t.value = t.value + v.value
        end
    end
    go(tblStks)
    
    return tblStks
end

local function StackJsonTrim(tblStk)
    assert(tblStk.value >= 0)
    if tblStk.children then
        tblStk.children = table.fmapKV(function(_, v) return StackJsonTrim(v) end
                                      ,tblStk.children)
        if not next(tblStk.children) then tblStk.children = nil end
    end
    
    local keep = (tblStk.value > 0) or tblStk.children
    return keep and tblStk or nil
end

local function StackJsonFinalise(tblStks)
    local function go(t)
        t.children = t.children or {}
        for _, v in pairs(t.children) do go(v) end
    end
    go(tblStks)

    return tblStks.children
end


local function StackProcess(tblStks)
    --return StackJsonFinalise(StackJsonSum(StackJsonTrim(StackJsonFold(tblStks))))
    return StackJsonFinalise(tblStks)
end

local function UnpackFirefoxProfile(strFileName)
    local tblProfile    = assert(js.decode(FileRead(strFileName .. ".json"), 1, nil)
                                ,"failed to decode JSON")

    local function ThreadStacksWalk(tblThread, fnWalker)
        local tblBadFrame   = {}
        local tblSamps      = tblThread.samples
        for _, arySample in pairs(tblSamps.data) do
            --print("stack")
            local function appendFrame(tblFrames, frameIdx)
                --print(frameIdx, #tblProfile.frames)
                local tblFrame      = assert(tblProfile.frames[frameIdx + 1])
                tblFrames[#tblFrames + 1] = tblFrame

                local nextIdx = (tblFrame.parent ~= 0) and tblFrame.parent
                                                       or  tblFrame.asyncParent
                if nextIdx ~= 0 then
                    assert(nextIdx ~= frameIdx)
                    local t = appendFrame(tblFrames, nextIdx)
                    return t
                end
                
                return tblFrames
            end

            local stackIdx          = arySample[tblSamps.schema.stack + 1]
            local aryStack          = tblThread.stackTable.data[stackIdx + 1]
            local frameHeadIdx      = aryStack[tblThread.stackTable.schema.frame + 1]
            local aryFrameHead      = assert(tblThread.frameTable.data[frameHeadIdx + 1])
            local frameHeadLocIdx   = aryFrameHead[tblThread.frameTable.schema.location + 1]
            if frameHeadLocIdx >= #tblProfile.frames then
                tblBadFrame[#tblBadFrame + 1] = frameHeadLocIdx
            else
                fnWalker(table.reverse(appendFrame({}, frameHeadLocIdx)))
            end
        end
        
        return tblBadFrame
    end

    for k, v in pairs(tblProfile.profile.threads) do
        local tblStacks     = {}
        local tblBadFrame   = ThreadStacksWalk(v, function(t)
            StackMerge(tblStacks, StackSelectSrcNames(t))
        end)
        
        local strFileOut = "../example/" .. strFileName .. "_thread_" .. k .. ".json"
        print("Writing to: ", strFileOut)
        FileWrite(strFileOut
                 ,js.encode(StackProcess(StackMergeToJsonPre(tblStacks, ""))
                           ,{ indent = true })
                 )
        print("Summery (Thread " .. k .. "):")
        print("Bad Stacks: ", #tblBadFrame)
    end

end

---[[
table.fmapKV(function(_, v) UnpackFirefoxProfile(v) end
            ,{---[ [
              "ff_2fg_workflowy1"
             ,"ff_workflowy1"
             ,"ff_rsiHomepage"
             ,"profile_pgLoad"
             ,"ff_fpsGame1"
             ,"ff_boids1"--] ]
             ,"ff_raytrace1"
             }
            )
--]]
--[[
local function StackPseudoGen(n, step)
    local function mkN(strName, nVal, opt_objKid)
        local t = { name        = strName
                  , value       = nVal
                  , children    = {}
                  }
        if opt_objKid then
            t.children[opt_objKid.name] = opt_objKid
        end
        
        return t
    end
    
    function go(nTotal, nStep)
        local nNext = nTotal - nStep
        return (nNext > 0) and mkN(tostring(nTotal), nStep, go(nNext, nStep))
                           or  nil
    end
    
    return mkN("root", 0, go(n, step))
end
FileWrite("../example/thread_pseudo_1.json"
         ,js.encode(StackJsonFinalise(StackPseudoGen(100, 5))
                   ,{ indent = true })
         )
--]]