# Handy API v3-beta — Method Reference
Auto-generated from `spec.yaml`. Line numbers point to the full spec.

Base URL: `https://www.handyfeeling.com/api/handy-rest/v3`


## AUTH

| Method | Path | Summary | Line |
|--------|------|---------|------|
| `GET` | `/auth/token/issue` | Issue a client API access token. | [:1773](spec.yaml#L1773) |

## HAMP

| Method | Path | Summary | Line |
|--------|------|---------|------|
| `PUT` | `/hamp/start` | Start the HAMP protocol. | [:1858](spec.yaml#L1858) |
| `GET` | `/hamp/state` | Get the current HAMP state of the device. | [:1802](spec.yaml#L1802) |
| `PUT` | `/hamp/stop` | Stop the HAMP protocol. | [:1907](spec.yaml#L1907) |
| `PUT` | `/hamp/stroke` | Set the HAMP stroke region. | [:2017](spec.yaml#L2017) |
| `PUT` | `/hamp/velocity` | Set the HAMP velocity. | [:1956](spec.yaml#L1956) |

## HDSP

| Method | Path | Summary | Line |
|--------|------|---------|------|
| `PUT` | `/hdsp/xat` | Send a XAT message to the device. | [:3285](spec.yaml#L3285) |
| `PUT` | `/hdsp/xava` | Send a XAVA message to the device. | [:2891](spec.yaml#L2891) |
| `PUT` | `/hdsp/xavp` | Send a XAVP message to the device. | [:2986](spec.yaml#L2986) |
| `PUT` | `/hdsp/xpt` | Send a XAT message to the device. | [:3382](spec.yaml#L3382) |
| `PUT` | `/hdsp/xpva` | Send a XPVA message to the device. | [:3085](spec.yaml#L3085) |
| `PUT` | `/hdsp/xpvp` | Send a XPVP message to the device. | [:3184](spec.yaml#L3184) |

## HSP

| Method | Path | Summary | Line |
|--------|------|---------|------|
| `PUT` | `/hsp/add` | Add points to the device HSP point buffer. | [:4191](spec.yaml#L4191) |
| `PUT` | `/hsp/flush` | Flush the HSP buffer. | [:4111](spec.yaml#L4111) |
| `PUT` | `/hsp/loop` | Set the HSP loop flag. | [:4846](spec.yaml#L4846) |
| `PUT` | `/hsp/pause` | Pause the HSP playback. | [:4592](spec.yaml#L4592) |
| `PUT` | `/hsp/pause/onstarving` | Set the HSP pause-on-starving flag. | [:4648](spec.yaml#L4648) |
| `PUT` | `/hsp/play` | Start the HSP playback. | [:4284](spec.yaml#L4284) |
| `PUT` | `/hsp/playbackrate` | Set the HSP playback rate. | [:4941](spec.yaml#L4941) |
| `PUT` | `/hsp/resume` | Resume the HSP playback. | [:4613](spec.yaml#L4613) |
| `PUT` | `/hsp/setup` | Setup a new HSP session on the device. | [:4012](spec.yaml#L4012) |
| `GET` | `/hsp/state` | Get the current HSP state of the device. | [:4473](spec.yaml#L4473) |
| `PUT` | `/hsp/stop` | Stop the HSP playback. | [:4393](spec.yaml#L4393) |
| `PUT` | `/hsp/synctime` | Adjust the stream synchronization. | [:4743](spec.yaml#L4743) |
| `PUT` | `/hsp/threshold` | Set the HSP tail point stream index threshold. | [:4498](spec.yaml#L4498) |

## HSSP

| Method | Path | Summary | Line |
|--------|------|---------|------|
| `PUT` | `/hssp/pause` | Pause the HSSP playback. | [:3853](spec.yaml#L3853) |
| `PUT` | `/hssp/play` | Start the HSSP playback. | [:3670](spec.yaml#L3670) |
| `PUT` | `/hssp/resume` | Resume the HSSP playback. | [:3874](spec.yaml#L3874) |
| `PUT` | `/hssp/setup` | Setup the HSSP protocol. | [:3561](spec.yaml#L3561) |
| `GET` | `/hssp/state` | Get the current HSSP state of the device. | [:3481](spec.yaml#L3481) |
| `PUT` | `/hssp/stop` | Stop the HSSP playback. | [:3774](spec.yaml#L3774) |
| `PUT` | `/hssp/synctime` | Adjust the stream synchronization. | [:3909](spec.yaml#L3909) |

## HSTP

| Method | Path | Summary | Line |
|--------|------|---------|------|
| `GET` | `/hstp/clocksync` | Initiate a server-device clock synchronization. | [:5111](spec.yaml#L5111) |
| `GET` | `/hstp/info` | Get the current device time information. | [:5036](spec.yaml#L5036) |
| `PUT` | `/hstp/offset` | Set the user adjusted device time offset. | [:5180](spec.yaml#L5180) |
| `GET` | `/hstp/offset` | Get the device time offset. | [:5263](spec.yaml#L5263) |

## HVP

| Method | Path | Summary | Line |
|--------|------|---------|------|
| `PUT` | `/hvp/start` | Start the HVP playback. | [:5520](spec.yaml#L5520) |
| `GET` | `/hvp/state` | Get the current HVP state of the device. | [:5339](spec.yaml#L5339) |
| `PUT` | `/hvp/state` | Set the current HVP state of the device. | [:5413](spec.yaml#L5413) |
| `PUT` | `/hvp/stop` | Stop the HVP playback. | [:5591](spec.yaml#L5591) |

## INFO

| Method | Path | Summary | Line |
|--------|------|---------|------|
| `GET` | `/capabilities` | Get the device capabilities. | [:2822](spec.yaml#L2822) |
| `GET` | `/connected` | Check device connectivity. | [:2423](spec.yaml#L2423) |
| `GET` | `/info` | Get the device information. | [:2121](spec.yaml#L2121) |
| `GET` | `/mode` | Get the current device mode. | [:2170](spec.yaml#L2170) |
| `PUT` | `/mode` | Set the device mode. | [:2251](spec.yaml#L2251) |
| `PUT` | `/mode2` | Set the device mode. | [:2335](spec.yaml#L2335) |
| `GET` | `/settings/slider` | Get the device slider settings. | [:2073](spec.yaml#L2073) |
| `GET` | `/sids` | Get the device session IDs. | [:2861](spec.yaml#L2861) |
| `GET` | `/statistics` | Device message statistics. | [:2778](spec.yaml#L2778) |

## SLIDER

| Method | Path | Summary | Line |
|--------|------|---------|------|
| `GET` | `/slider/state` | Get the current state of the device slider. | [:5662](spec.yaml#L5662) |
| `PUT` | `/slider/stroke` | Set the stroke settings of the device slider. | [:5733](spec.yaml#L5733) |
| `GET` | `/slider/stroke` | Get the stroke settings of the device slider. | [:5806](spec.yaml#L5806) |

## SSE

| Method | Path | Summary | Line |
|--------|------|---------|------|
| `GET` | `/sse` | Subscribe to device events over SSE. | [:2500](spec.yaml#L2500) |

## STREAM

| Method | Path | Summary | Line |
|--------|------|---------|------|
| `PUT` | `/stream/play` | Start the stream playback. | [:5976](spec.yaml#L5976) |
| `PUT` | `/stream/setup` | Setup the stream protocol. | [:5877](spec.yaml#L5877) |
| `GET` | `/stream/state` | Get the current stream state of the device. | [:6162](spec.yaml#L6162) |
| `PUT` | `/stream/stop` | Stop the stream playback. | [:6082](spec.yaml#L6082) |
| `PUT` | `/stream/synctime` | Adjust the stream synchronization. | [:6242](spec.yaml#L6242) |

## UTILS

| Method | Path | Summary | Line |
|--------|------|---------|------|
| `GET` | `/servertime` | Get the current server time. | [:2729](spec.yaml#L2729) |

---
## Detailed Descriptions

### `GET /auth/token/issue` ([spec.yaml:1773](spec.yaml#L1773))

**operationId:** `issueToken`  
**tags:** AUTH  

This endpoint generates a client-token for API authentication. The endpoint can only be accessed with an ApplicationKey. A client-token authenticates a client with the device API endpoints that requires authentication. Use it by including the token as a Bearer token in the Authorization header. It can be used in client applications, including web browsers and mobile apps. It's an alternativ to the ApplicationID that should be harder to abuse outside your application's browser environment. A token is valid for a limited time, after which it expires. The default lifetime for a token is 1 hour. You can adjust this lifespan up to a maximum of 24 hours using the `ttl` parameter. A token can be configured with the following optional restrictions: - Device connection key - Client IP - Client Origin - Client Referer - Client User-Agent - Client Accept-Language - Client Accept-Encoding - Client Cache-Control Specifying a device connection key ensures that the token can only be used with a specific device. The client values forms a lightweight client fingerprint that makes it harder to abuse the token outside the client environment. **NOTE**: Issuing a client-token for a specific device does not eliminate the need to include the connection key when sending device commands. The `X-Connection-Key` header is still required for device-specific operations, even if the client-token was issued for that device. ### Token Renewal Alongside the token, you receive a **renew** URL. Use this URL to extend your token's validity, ensuring uninterrupted service for long-running applications. The renew URL remains valid as long as the token is valid. Remember to renew before the token expires; post-expiration, both the token and renew URL become invalid, necessitating a new token issue. The renew operation only extends the token's lifespan. It does not alter initial restrictions (device connection key or other client values) set during token issuance.

### `GET /hamp/state` ([spec.yaml:1802](spec.yaml#L1802))

**operationId:** `getHampState`  
**tags:** HAMP  

Get the current HAMP state of the device. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hamp">Handy Alternate Motion Protocol (HAMP)</a> for additional information about the HAMP protocol and code samples.

### `PUT /hamp/start` ([spec.yaml:1858](spec.yaml#L1858))

**operationId:** `startHamp`  
**tags:** HAMP  

Start the HAMP movement. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hamp">Handy Alternate Motion Protocol (HAMP)</a> for additional information about the HAMP protocol and code samples.

### `PUT /hamp/stop` ([spec.yaml:1907](spec.yaml#L1907))

**operationId:** `stopHamp`  
**tags:** HAMP  

Stop the HAMP movement. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hamp">Handy Alternate Motion Protocol (HAMP)</a> for additional information about the HAMP protocol and code samples.

### `PUT /hamp/velocity` ([spec.yaml:1956](spec.yaml#L1956))

**operationId:** `setHampVelocity`  
**tags:** HAMP  

Set the HAMP velocity. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hamp">Handy Alternate Motion Protocol (HAMP)</a> for additional information about the HAMP protocol and code samples.

### `PUT /hamp/stroke` ([spec.yaml:2017](spec.yaml#L2017))

**operationId:** `setHampStroke`  
**tags:** HAMP  

Set the HAMP stroke region. The HAMP stroke region defines the movement range of the device within the current stroke region. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hamp">Handy Alternate Motion Protocol (HAMP)</a> for additional information about the HAMP protocol and code samples.

### `GET /settings/slider` ([spec.yaml:2073](spec.yaml#L2073))

**operationId:** `getSliderSettings`  
**tags:** INFO  

Get the device slider settings. To change device slider settings, use the Handy onboarding app.

### `GET /info` ([spec.yaml:2121](spec.yaml#L2121))

**operationId:** `getDeviceInfo`  
**tags:** INFO  

Get the device information.

### `GET /mode` ([spec.yaml:2170](spec.yaml#L2170))

**operationId:** `getMode`  
**tags:** INFO  

Get the current device mode.

### `PUT /mode` ([spec.yaml:2251](spec.yaml#L2251))

**operationId:** `setMode`  
**tags:** INFO  

`DEPRECATEAD`. Use `/mode2` endpoint instead which returns additional information in the response. Kept for backwards compatibility. Set the device mode.

### `PUT /mode2` ([spec.yaml:2335](spec.yaml#L2335))

**operationId:** `setMode2`  
**tags:** INFO  

Set the device mode and returns the active mode and mode_session_id.

### `GET /connected` ([spec.yaml:2423](spec.yaml#L2423))

**operationId:** `isConnected`  
**tags:** INFO  

Check if the device with the specific connection key is connected. This is the fastest way to check device connectivity. To receive continouos updates on device connectivity and device state use the SSE endpoint to subscribe to device events.

### `GET /sse` ([spec.yaml:2500](spec.yaml#L2500))

**operationId:** `getEvents`  
**tags:** SSE  

Starts a Server-Sent Events (SSE) stream for real-time updates on device events. It's an efficient way to receive continuous updates on device connectivity, mode changes, and other relevant events without the need to poll API endpoints. To reveive events for a single device, specify the device connection key with the `ck` query parameter. To receive events for multiple devices, a channel reference can be specified with the `ck` query parameter. This will receive events from all channel subcribers. Optionally filter events by specifying the `events` query parameter. If not specified, all events are pushed to the client. Ex. events=device_connected,device_disconnected **NOTE1:**The Swagger UI does not support SSE, so you can not directly test the endpoint from this page. The endpoint works with any SSE-compatible client, such as a browser or a dedicated SSE client. **NOTE2:**The endpoint requires authentication. Since SSE does not support headers, the credentials must be passed as a query parameter (apikey). You can use an ApplicationID or an issued client token as the apikey value. This Handy v3 OpenAPI specification defines schema definitions for each event type. If you use a code generation tool that generates schemas, you should be able to use these types when parsing the SSE stream events. The SSE stream provides the following events: - `battery_changed` Received when the battery status have changed. - `ble_status_changed` Received when the BLE status have changed. - `button_event` Received in case of an unhandled button event. Eg. the user uses a device button in a way ignored by the current device mode. - `device_clock_synchronized` Received when the device clock have finished synchronization with the server clock. - `device_connected` Received when the device connects. - `device_disconnected` Received when the device disconnects. - `device_error` Received when a device error occurs. - `device_status` Received when starting the SSE connection. - `hamp_state_changed` Received when the HAMP state have changed. - `hrpp_state_changed` Received when the HRPP state have changed. - `hdsp_state_changed` Received when the HDSP state have changed. - `hsp_looping` Received when the HSP starts a new loop. - `hsp_starving` Received when the HSP is starving (no more data to play). Only sent if pause_on_starving is disabled. - `hsp_state_changed` Received when the HSP state have changed. - `hsp_threshold_reached` Received when the HSP data threshold is reached. - `hsp_paused_on_starving` Received when the HSP is paused due to starvation. Only sent if pause_on_starving is enabled. - `hsp_resumed_on_not_starving` Received when the HSP is resumed after starvation and playable data is available. Only sent if pause_on_starving is enabled. - `stream_end_reached` Received when the end of a closed stream have been reached. This includes scripts played with the HSSP protocol or closed streams played with STREAM protocol. - `hvp_state_changed` Received when the HVP state changes. - `low_memory_error` Received when the device failed to handle some command due to memory limitations. - `low_memory_warning` Received when the device's available free memory is critically low. - `mode_changed` Received when the device mode have changed. - `ota_progress` Received when the OTA progress have changed. - `slider_blocked` Received when the slider is blocked. - `slider_unblocked` Received when the slider is unblocked. - `stroke_changed` Received when the stroke region have changed. - `temp_high` Received when the device temperature is high. - `temp_ok` Received when the device temperature is back to normal. - `wifi_scan_complete` Received when a device wifi scan have completed. - `wifi_status_changed` Received when the wifi status have changed. See [Handy v3 API documentation](https://ohdoki.notion.site/Handy-API-v3-ea6c47749f854fbcabcc40c729ea6df4) for more information and code samples.

### `GET /servertime` ([spec.yaml:2729](spec.yaml#L2729))

**operationId:** `getServerTime`  
**tags:** UTILS  

This endpoint provides the current server time, necessary for calculating the client-server offset (cs_offset). This offset is crucial for estimating the server time on the client side (Tcest). **Calculating Client-Server Offset (cs_offset)** 1. **Sample Collection**: Obtain N samples of server time (Ts) from the endpoint. More samples improve accuracy but increase estimation time. A good starting point is 30 samples. 2. **Round-Trip Delay (RTD) Measurement**: For each sample, record the send time (Tsend) and receive time (Treceive). Calculate RTD as Treceive - Tsend. 3. **Server Time Estimation (Ts_est)**: Estimate the server time at response receipt by adding half of the RTD to the server time (Ts). Formula: Ts_est = Ts + RTD/2. 4. **Offset Calculation**: Determine the offset between Ts_est and client time (Tc) at response receipt. Since Tc equals Treceive, the offset is Ts_est - Treceive. 5. **Aggregate Offset Update**: Update the aggregated offset value (offset_agg) by adding the new offset. Formula: offset_agg = offset_agg + offset. 6. **Average Offset (cs_offset)**: After all samples are processed, calculate the average offset by dividing offset_agg by the number of samples (X). Formula: cs_offset = offset_agg / X. This method provides a reliable estimate of the client-server offset (cs_offset). Typically, cs_offset is calculated once and used for future Tcest calculations. However, if synchronization issues arise (due to network changes, clock drift, etc.), recalculating cs_offset may be beneficial. **Calculating Client-Side Estimated Server Time (Tcest)** The Tcest value, required for certain API endpoints (e.g., /hssp/play), is calculated as follows: Tcest = Tc + cs_offset where Tc is the current client time and cs_offset is the pre-calculated client-server offset.

### `GET /statistics` ([spec.yaml:2778](spec.yaml#L2778))

**operationId:** `getStatistics`  
**tags:** INFO  

The device message statistics provides information about the device message traffic.

### `GET /capabilities` ([spec.yaml:2822](spec.yaml#L2822))

**operationId:** `getDeviceCapabilities`  
**tags:** INFO  

Get the device capabilities.

### `GET /sids` ([spec.yaml:2861](spec.yaml#L2861))

**operationId:** `getDeviceSessionIds`  
**tags:** INFO  

Get the device's session IDs.

### `PUT /hdsp/xava` ([spec.yaml:2891](spec.yaml#L2891))

**operationId:** `sendXava`  
**tags:** HDSP  

Sets the next absolute position (xa) of the device, and the absolute velocity (va) the device should use to reach the position. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hdsp">Handy Direct Streaming Protocol (HDSP)</a> for additional information about the HDSP protocol and code samples.

### `PUT /hdsp/xavp` ([spec.yaml:2986](spec.yaml#L2986))

**operationId:** `sendXavp`  
**tags:** HDSP  

Sets the next absolute position (xa) of the device, and the percent velocity (vp) the device should use to reach the position. See the request schema definition for more information. See <a href="">Notion</a> for additional information and code samples.

### `PUT /hdsp/xpva` ([spec.yaml:3085](spec.yaml#L3085))

**operationId:** `sendXpva`  
**tags:** HDSP  

Sets the next percent position (xp) of the device, and the absolute velocity (va) the device should use to reach the position. See the request schema definition for more information. See <a href="">Notion</a> for additional information and code samples.

### `PUT /hdsp/xpvp` ([spec.yaml:3184](spec.yaml#L3184))

**operationId:** `sendXpvp`  
**tags:** HDSP  

Sets the next percent position (xp) of the device, and the percent velocity (vp) the device should use to reach the position. See the request schema definition for more information See <a href="">Notion</a> for additional information and code samples.

### `PUT /hdsp/xat` ([spec.yaml:3285](spec.yaml#L3285))

**operationId:** `sendXat`  
**tags:** HDSP  

Sets the next absolute position (xa) of the device, and the time (t) the device should use to reach the position. See the request schema definition for more information. See <a href="">Notion</a> for additional information and code samples.

### `PUT /hdsp/xpt` ([spec.yaml:3382](spec.yaml#L3382))

**operationId:** `sendXpt`  
**tags:** HDSP  

Sets the next percent position (xp) of the device, and the time (t) the device should use to reach the position. See the request schema definition for more information. See <a href="">Notion</a> for additional information and code samples.

### `GET /hssp/state` ([spec.yaml:3481](spec.yaml#L3481))

**operationId:** `getHsspState`  
**tags:** HSSP  

Get the current HSSP state of the device. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hssp">Handy Synchronized Script Protocol (HSSP)</a> for additional information about the HSSP protocol and code samples.

### `PUT /hssp/setup` ([spec.yaml:3561](spec.yaml#L3561))

**operationId:** `hsspSetup`  
**tags:** HSSP  

Setup the HSSP protocol. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hssp">Handy Synchronized Script Protocol (HSSP)</a> for additional information about the HSSP protocol and code samples. If you can't host your own scripts, you can use our script hosting service to get a temporary script download URL: See the [Hosting API](https://www.handyfeeling.com/api/hosting/v2/docs/) or the [Hosting API docs](https://ohdoki.notion.site/Hosting-API-v2-814e654381e74f2faebe2ebd908a878f)

### `PUT /hssp/play` ([spec.yaml:3670](spec.yaml#L3670))

**operationId:** `hsspPlay`  
**tags:** HSSP  

Start the HSSP playback. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hssp">Handy Synchronized Script Protocol (HSSP)</a> for additional information about the HSSP protocol and code samples.

### `PUT /hssp/stop` ([spec.yaml:3774](spec.yaml#L3774))

**operationId:** `hsspStop`  
**tags:** HSSP  

Stop the HSSP playback. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hssp">Handy Synchronized Script Protocol (HSSP)</a> for additional information about the HSSP protocol and code samples.

### `PUT /hssp/pause` ([spec.yaml:3853](spec.yaml#L3853))

**operationId:** `hsspPause`  
**tags:** HSSP  

Pause the HSSP playback. Pause will pause the playback, but keep the current position. A subsequent resume command will continue playback from the paused position or from the current 'live' script position/time, depending on the resume `pickUp` flag. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hssp/resume` ([spec.yaml:3874](spec.yaml#L3874))

**operationId:** `hsspResume`  
**tags:** HSSP  

Resume the HSSP playback. Depending on the `pickUp` parameter, resume will either continue from the paused position (`pickUp` = false) or jump to the current 'live' position/time of the script (`pickUp` = true). See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hssp/synctime` ([spec.yaml:3909](spec.yaml#L3909))

**operationId:** `setHsspTime`  
**tags:** HSSP  

Adjust the stream playtime using the provided current time sample from the external source and filter. This can improve the synchronization between the device and the external source when the current time samples have some variable inaccuracies. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hssp">Handy Synchronized Script Protocol (HSSP)</a> for additional information about the HSSP protocol and code samples.

### `PUT /hsp/setup` ([spec.yaml:4012](spec.yaml#L4012))

**operationId:** `hspSetup`  
**tags:** HSP  

Setup initializes a new HSP session on the device. This ensures both the device and server are properly prepared, clearing any existing HSP session state. If the device is already in an HSP session and no setup command is issued, all HSP commands will modify the existing session, which may lead to unexpected behavior. The `stream_id` is an optional session identifier. If it changes during a HSP session, it indicates that a new session has been initiated by a client. If no `stream_id` is provided, one will be generated and returned in the setup response. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hsp/flush` ([spec.yaml:4111](spec.yaml#L4111))

**operationId:** `hspFlush`  
**tags:** HSP  

Flush will remove all existing points from the device point buffer. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hsp/add` ([spec.yaml:4191](spec.yaml#L4191))

**operationId:** `hspAdd`  
**tags:** HSP  

You can add up to 100 points to the device's point buffer in a single command. If the buffer is full, adding N points will remove the first N points to make room for the new ones. The `flush` flag can be used to remove all existing points from the buffer before adding the new points. The `tail_point_threshold` parameter can be used to update the tail point stream index threshold after the points have been added. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hsp/play` ([spec.yaml:4284](spec.yaml#L4284))

**operationId:** `hspPlay`  
**tags:** HSP  

Start the HSP playback. An optional add points command can be embedded in the play command. The add command (if present) will be executed before the playback starts. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hsp/stop` ([spec.yaml:4393](spec.yaml#L4393))

**operationId:** `hspStop`  
**tags:** HSP  

Stop the HSP playback. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `GET /hsp/state` ([spec.yaml:4473](spec.yaml#L4473))

**operationId:** `getHspState`  
**tags:** HSP  

Get the current HSP state of the device. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hsp/threshold` ([spec.yaml:4498](spec.yaml#L4498))

**operationId:** `setHspThreshold`  
**tags:** HSP  

Set the HSP tail point stream index threshold. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hsp/pause` ([spec.yaml:4592](spec.yaml#L4592))

**operationId:** `hspPause`  
**tags:** HSP  

Pause the HSP playback. Pause will pause the playback, but keep the current position. A subsequent resume command will continue playback from the paused position or from the current 'live' stream position, depending on the resume command parameters. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hsp/resume` ([spec.yaml:4613](spec.yaml#L4613))

**operationId:** `hspResume`  
**tags:** HSP  

Resume the HSP playback. Depending on the `pick_up` parameter, resume will either continue from the paused position (`pick_up` = false) or jump to the current 'live' position of the stream (`pick_up` = true). See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hsp/pause/onstarving` ([spec.yaml:4648](spec.yaml#L4648))

**operationId:** `setHspPauseOnStarving`  
**tags:** HSP  

Set the HSP pause-on-starving flag. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hsp/synctime` ([spec.yaml:4743](spec.yaml#L4743))

**operationId:** `setHspTime`  
**tags:** HSP  

Adjust the stream playtime using the provided current time sample from the external source and filter. This can improve the synchronization between the device and the external source when the current time samples have some variable inaccuracies. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hsp/loop` ([spec.yaml:4846](spec.yaml#L4846))

**operationId:** `setHspLoop`  
**tags:** HSP  

Set the HSP loop flag. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `PUT /hsp/playbackrate` ([spec.yaml:4941](spec.yaml#L4941))

**operationId:** `setHspPaybackRate`  
**tags:** HSP  

Set the HSP playback rate. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hsp">Handy Streaming Protocol (HSP)</a> for additional information about the HSP protocol and code samples.

### `GET /hstp/info` ([spec.yaml:5036](spec.yaml#L5036))

**operationId:** `getDeviceTimeInfo`  
**tags:** HSTP  

Get the current device time information.

### `GET /hstp/clocksync` ([spec.yaml:5111](spec.yaml#L5111))

**operationId:** `clockSync`  
**tags:** HSTP  

Initiate a server-device clock synchronization.

### `PUT /hstp/offset` ([spec.yaml:5180](spec.yaml#L5180))

**operationId:** `setOffset`  
**tags:** HSTP  

Set the user adjusted device time offset.

### `GET /hstp/offset` ([spec.yaml:5263](spec.yaml#L5263))

**operationId:** `getOffset`  
**tags:** HSTP  

Get the user adjusted device time offset.

### `GET /hvp/state` ([spec.yaml:5339](spec.yaml#L5339))

**operationId:** `getHvpState`  
**tags:** HVP  

Get the current HVP state of the device. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hvp">Handy Vibration Protocol (HVP)</a> for additional information about the HVP protocol and code samples.

### `PUT /hvp/state` ([spec.yaml:5413](spec.yaml#L5413))

**operationId:** `setHvpState`  
**tags:** HVP  

Set the HVP state of the device. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hvp">Handy Vibration Protocol (HVP)</a> for additional information about the HVP protocol and code samples.

### `PUT /hvp/start` ([spec.yaml:5520](spec.yaml#L5520))

**operationId:** `hvpStart`  
**tags:** HVP  

Start the HVP playback. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hvp">Handy Vibration Protocol (HVP)</a> for additional information about the HVP protocol and code samples.

### `PUT /hvp/stop` ([spec.yaml:5591](spec.yaml#L5591))

**operationId:** `hvpStop`  
**tags:** HVP  

Stop the HVP playback. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-hvp">Handy Vibration Protocol (HVP)</a> for additional information about the HVP protocol and code samples.

### `GET /slider/state` ([spec.yaml:5662](spec.yaml#L5662))

**operationId:** `getSlideState`  
**tags:** SLIDER  

Get the current state of the device slider.

### `PUT /slider/stroke` ([spec.yaml:5733](spec.yaml#L5733))

**operationId:** `setStroke`  
**tags:** SLIDER  

Set the minimum and/or maximum allowed relative slider position of the device. The slider will not move outside the specified stroke zone.

### `GET /slider/stroke` ([spec.yaml:5806](spec.yaml#L5806))

**operationId:** `getStroke`  
**tags:** SLIDER  

Get the minimum and maximum allowed relative slider position of the device.

### `PUT /stream/setup` ([spec.yaml:5877](spec.yaml#L5877))

**operationId:** `setupStream`  
**tags:** STREAM  

Setup the stream protocol to play a stream. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-stream">Stream Protocol (STREAM)</a> for additional information about the STREAM protocol and code samples.

### `PUT /stream/play` ([spec.yaml:5976](spec.yaml#L5976))

**operationId:** `streamPlay`  
**tags:** STREAM  

Start the stream playback. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-stream">Stream Protocol (STREAM)</a> for additional information about the STREAM protocol and code samples.

### `PUT /stream/stop` ([spec.yaml:6082](spec.yaml#L6082))

**operationId:** `streamStop`  
**tags:** STREAM  

Stop the stream playback. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-stream">Stream Protocol (STREAM)</a> for additional information about the STREAM protocol and code samples.

### `GET /stream/state` ([spec.yaml:6162](spec.yaml#L6162))

**operationId:** `getStreamState`  
**tags:** STREAM  

Get the current stream state of the device. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-stream">Stream Protocol (STREAM)</a> for additional information about the STREAM protocol and code samples.

### `PUT /stream/synctime` ([spec.yaml:6242](spec.yaml#L6242))

**operationId:** `setStreamTime`  
**tags:** STREAM  

Adjust the stream playtime using the provided current time sample from the external source and filter. This can improve the synchronization between the device and the external source when the current time samples have some variable inaccuracies. See the request body schema definition for details.<br><br>See <a href="https://links.handyfeeling.com/docs-api-handy-rest-v3-stream">Stream Protocol (STREAM)</a> for additional information about the STREAM protocol and code samples.

