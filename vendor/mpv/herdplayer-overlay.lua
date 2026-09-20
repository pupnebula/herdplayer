local mp = require 'mp'
local utils = require 'mp.utils'

local overlay = mp.create_osd_overlay('ass-events')
local actions = {}
local pending_actions = nil
local offset_ms = 0
local accent = '&H3A86E8&' -- ASS colors are BBGGRR.
local playback_time = nil
local last_signature = nil

local function clamp(value, low, high)
    return math.max(low, math.min(high, value))
end

local function position_at(time_ms)
    local count = #actions
    if count == 0 then return nil end
    if time_ms <= actions[1].at then return actions[1].pos end
    if time_ms >= actions[count].at then return actions[count].pos end

    local low, high = 1, count
    while low < high - 1 do
        local middle = math.floor((low + high) / 2)
        if actions[middle].at <= time_ms then low = middle else high = middle end
    end

    local first, second = actions[low], actions[high]
    if second.at <= first.at then return second.pos end
    local ratio = (time_ms - first.at) / (second.at - first.at)
    return first.pos + (second.pos - first.pos) * ratio
end

local function circle_path(cx, cy, radius)
    local k = radius * 0.55228475
    return string.format(
        'm %.1f %.1f b %.1f %.1f %.1f %.1f %.1f %.1f ' ..
        'b %.1f %.1f %.1f %.1f %.1f %.1f ' ..
        'b %.1f %.1f %.1f %.1f %.1f %.1f ' ..
        'b %.1f %.1f %.1f %.1f %.1f %.1f',
        cx + radius, cy,
        cx + radius, cy - k, cx + k, cy - radius, cx, cy - radius,
        cx - k, cy - radius, cx - radius, cy - k, cx - radius, cy,
        cx - radius, cy + k, cx - k, cy + radius, cx, cy + radius,
        cx + k, cy + radius, cx + radius, cy + k, cx + radius, cy
    )
end

local function clear_overlay()
    overlay:remove()
    last_signature = nil
end

local function render(force)
    if #actions == 0 or playback_time == nil then
        if last_signature ~= nil then clear_overlay() end
        return
    end

    local width, height = mp.get_osd_size()
    if not width or not height or width < 1 or height < 1 then return end

    local position = clamp(position_at(playback_time * 1000 + offset_ms) or 50, 0, 100)
    local center_x = math.floor(width - 17)
    local top = math.floor(height * 0.10)
    local bottom = math.floor(height * 0.90)
    local center_y = math.floor(bottom - (position / 100) * (bottom - top) + 0.5)
    local signature = string.format('%d:%d:%d:%s', width, height, center_y, accent)
    if not force and signature == last_signature then return end
    last_signature = signature

    local track = string.format(
        '{\\an7\\pos(0,0)\\bord0\\shad0\\1c&HFFFFFF&\\1a&HDC&\\p1}' ..
        'm %d %d l %d %d %d %d %d %d',
        center_x - 3, top, center_x + 3, top,
        center_x + 3, bottom, center_x - 3, bottom
    )
    local glow = string.format(
        '{\\an7\\pos(0,0)\\bord0\\shad0\\1c%s\\1a&HC8&\\p1}%s',
        accent, circle_path(center_x, center_y, 11)
    )
    local thumb = string.format(
        '{\\an7\\pos(0,0)\\bord0\\shad0\\1c%s\\1a&H00&\\p1}%s',
        accent, circle_path(center_x, center_y, 7)
    )

    overlay.res_x = width
    overlay.res_y = height
    overlay.data = table.concat({ track, glow, thumb }, '\n')
    overlay:update()
end

mp.observe_property('time-pos', 'number', function(_, value)
    playback_time = value
end)

mp.register_script_message('herdplayer-script-begin', function()
    pending_actions = {}
end)

mp.register_script_message('herdplayer-script-chunk', function(json)
    if pending_actions == nil then pending_actions = {} end
    local chunk = utils.parse_json(json)
    if type(chunk) ~= 'table' then return end
    for _, action in ipairs(chunk) do
        local at, pos = tonumber(action.at), tonumber(action.pos)
        if at and pos then
            pending_actions[#pending_actions + 1] = {
                at = math.floor(at + 0.5),
                pos = clamp(pos, 0, 100),
            }
        end
    end
end)

mp.register_script_message('herdplayer-script-end', function()
    actions = pending_actions or {}
    pending_actions = nil
    last_signature = nil
    render(true)
end)

mp.register_script_message('herdplayer-clear-script', function()
    actions = {}
    pending_actions = nil
    clear_overlay()
end)

mp.register_script_message('herdplayer-offset', function(value)
    offset_ms = tonumber(value) or 0
    render(true)
end)

mp.register_script_message('herdplayer-accent', function(red, green, blue)
    local r = clamp(math.floor((tonumber(red) or 232) + 0.5), 0, 255)
    local g = clamp(math.floor((tonumber(green) or 134) + 0.5), 0, 255)
    local b = clamp(math.floor((tonumber(blue) or 58) + 0.5), 0, 255)
    accent = string.format('&H%02X%02X%02X&', b, g, r)
    render(true)
end)

mp.add_periodic_timer(1 / 30, function() render(false) end)
