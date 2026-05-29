# Amostras pra engenharia reversa do Maskai

Largue aqui (qualquer nome, mas ajuda seguir o padrão):

- `original.<ext>` — o arquivo que você SUBIU no Maskai (entrada crua).

curl 'https://api.maskai.co/api/uploads/presign' \
  -H 'accept: */*' \
  -H 'accept-language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6,zh-CN;q=0.5,zh;q=0.4' \
  -H 'cache-control: no-cache' \
  -H 'content-type: application/json' \
  -b '_fbp=fb.1.1780054525324.206936668787366448.AQYCAQMA; refresh_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5NzQ3MGQzMS0yYjE5LTQzMDItYjA4My1jYjI1ZGFmMWVkYmIiLCJqdGkiOiI5ZGFjZDRkOC02NGNhLTQ4NDgtYTQzNS04MTA2ZWU4ZjZlNDEiLCJ0eXBlIjoicmVmcmVzaCIsImlhdCI6MTc4MDA2OTIxNywiZXhwIjoxNzgyNjYxMjE3fQ.MGcdlq6F4NHwWQuyKHwhOna833s2fjxNTHkc4XxDg70; ab_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5NzQ3MGQzMS0yYjE5LTQzMDItYjA4My1jYjI1ZGFmMWVkYmIiLCJlbWFpbCI6ImhpYWdvYnJhbWJhdHRpQGdtYWlsLmNvbSIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzgwMDg1MTUxLCJleHAiOjE3ODA2ODk5NTF9.vw9V_qUUDMNmlIdOwG-f_7pv_eqvjVMqZehHSY6tSXw' \
  -H 'origin: https://www.maskai.co' \
  -H 'pragma: no-cache' \
  -H 'priority: u=1, i' \
  -H 'referer: https://www.maskai.co/' \
  -H 'sec-ch-ua: "Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-site' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36' \
  --data-raw '{"filename":"FAVO DE MEL EXPLICAÇÃO - IANDÊ_camuflado.mp4","contentType":"video/mp4","deviceSignals":{"deviceId":"1ef1435a-69a0-4282-a2b3-b7fccab55d5a","visitorId":"572792bfc93f5b04f487df7cd0ed5b1e","visitorIdHashClient":"e631c2d0e53f165a1eae209f5cb690793c5e26e2350a9077cf590eb69e6f805c","fingerprintVersion":"1","timezone":"America/Sao_Paulo","language":"pt-BR","languages":["pt-BR","pt","en-US","en","ja"],"platform":"Win32","screenWidthBucket":"1366-1919","screenHeightBucket":"<1024","colorDepth":32,"devicePixelRatio":1,"hardwareConcurrency":16,"deviceMemory":16,"touchSupport":false,"cookieEnabled":true,"localStorageAvailable":true,"sessionStorageAvailable":true,"indexedDbAvailable":true,"canvasHash":"b408a210d0254e073536aea9d5bd67bfa59cf10c76f25c372cc652e0ffa215d8","webglVendor":"WebKit","webglRenderer":"WebKit WebGL","audioHash":"ec525d648de56ae1425c4961890725e09ca6b2cd0447a4019d21b0bb6f84a67d","fontsHash":"e32c18688e9887f1c98b5c5d51d5306bf6bedc56612962c5bf47c477b92b885e","pluginsHash":"a1f1a94e590024d2ca793bd3a90eefe3ead1671710b37e7175bec6e9f528cedf","webrtcIps":["131.221.91.183","0.0.0.0","2804:30c:864:a800:a406:683a:2a0d:9502"],"webglUnmaskedVendor":"Google Inc. (Intel)","webglUnmaskedRenderer":"ANGLE (Intel, Intel(R) UHD Graphics (0x0000A7A8) Direct3D11 vs_5_0 ps_5_0, D3D11)","mediaDevicesHash":"ae1747fbdb4a2d312709e8136efed04e2e16f875da8c0679bd325a082993248c","confidence":0.6,"generatedAt":"2026-05-29T20:14:12.043Z"}}'

  curl 'https://api.maskai.co/api/uploads/presign' \
  -X 'OPTIONS' \
  -H 'accept: */*' \
  -H 'accept-language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6,zh-CN;q=0.5,zh;q=0.4' \
  -H 'access-control-request-headers: content-type' \
  -H 'access-control-request-method: POST' \
  -H 'cache-control: no-cache' \
  -H 'origin: https://www.maskai.co' \
  -H 'pragma: no-cache' \
  -H 'priority: u=1, i' \
  -H 'referer: https://www.maskai.co/' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-site' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'



- `maskai.<ext>` — o arquivo que o Maskai DEVOLVEU (saída processada).

curl 'https://api.maskai.co/api/process-video' \
  -H 'accept: */*' \
  -H 'accept-language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6,zh-CN;q=0.5,zh;q=0.4' \
  -H 'cache-control: no-cache' \
  -H 'content-type: application/json' \
  -b '_fbp=fb.1.1780054525324.206936668787366448.AQYCAQMA; refresh_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5NzQ3MGQzMS0yYjE5LTQzMDItYjA4My1jYjI1ZGFmMWVkYmIiLCJqdGkiOiI5ZGFjZDRkOC02NGNhLTQ4NDgtYTQzNS04MTA2ZWU4ZjZlNDEiLCJ0eXBlIjoicmVmcmVzaCIsImlhdCI6MTc4MDA2OTIxNywiZXhwIjoxNzgyNjYxMjE3fQ.MGcdlq6F4NHwWQuyKHwhOna833s2fjxNTHkc4XxDg70; ab_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5NzQ3MGQzMS0yYjE5LTQzMDItYjA4My1jYjI1ZGFmMWVkYmIiLCJlbWFpbCI6ImhpYWdvYnJhbWJhdHRpQGdtYWlsLmNvbSIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzgwMDg1MTUxLCJleHAiOjE3ODA2ODk5NTF9.vw9V_qUUDMNmlIdOwG-f_7pv_eqvjVMqZehHSY6tSXw' \
  -H 'origin: https://www.maskai.co' \
  -H 'pragma: no-cache' \
  -H 'priority: u=1, i' \
  -H 'referer: https://www.maskai.co/' \
  -H 'sec-ch-ua: "Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-site' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36' \
  --data-raw '{"bucket":"uploads","path":"97470d31-2b19-4302-b083-cb25daf1edbb/FAVO_DE_MEL_EXPLICACAO_-_IANDE_camuflado-1780085652740.mp4","sessionId":"76d54514-6120-4598-80a3-558de0b550c3","category":"ed","strategy":"dual","options":["aiProtection","audioEncryption"],"locale":"pt","deviceSignals":{"deviceId":"1ef1435a-69a0-4282-a2b3-b7fccab55d5a","visitorId":"572792bfc93f5b04f487df7cd0ed5b1e","visitorIdHashClient":"e631c2d0e53f165a1eae209f5cb690793c5e26e2350a9077cf590eb69e6f805c","fingerprintVersion":"1","timezone":"America/Sao_Paulo","language":"pt-BR","languages":["pt-BR","pt","en-US","en","ja"],"platform":"Win32","screenWidthBucket":"1366-1919","screenHeightBucket":"<1024","colorDepth":32,"devicePixelRatio":1,"hardwareConcurrency":16,"deviceMemory":16,"touchSupport":false,"cookieEnabled":true,"localStorageAvailable":true,"sessionStorageAvailable":true,"indexedDbAvailable":true,"canvasHash":"b408a210d0254e073536aea9d5bd67bfa59cf10c76f25c372cc652e0ffa215d8","webglVendor":"WebKit","webglRenderer":"WebKit WebGL","audioHash":"ec525d648de56ae1425c4961890725e09ca6b2cd0447a4019d21b0bb6f84a67d","fontsHash":"e32c18688e9887f1c98b5c5d51d5306bf6bedc56612962c5bf47c477b92b885e","pluginsHash":"a1f1a94e590024d2ca793bd3a90eefe3ead1671710b37e7175bec6e9f528cedf","webrtcIps":["131.221.91.183","0.0.0.0","2804:30c:864:a800:a406:683a:2a0d:9502"],"webglUnmaskedVendor":"Google Inc. (Intel)","webglUnmaskedRenderer":"ANGLE (Intel, Intel(R) UHD Graphics (0x0000A7A8) Direct3D11 vs_5_0 ps_5_0, D3D11)","mediaDevicesHash":"ae1747fbdb4a2d312709e8136efed04e2e16f875da8c0679bd325a082993248c","confidence":0.6,"generatedAt":"2026-05-29T20:14:12.043Z"}}'


  curl 'https://api.maskai.co/api/subscription' \
  -H 'accept: */*' \
  -H 'accept-language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6,zh-CN;q=0.5,zh;q=0.4' \
  -H 'cache-control: no-cache' \
  -H 'content-type: application/json' \
  -b '_fbp=fb.1.1780054525324.206936668787366448.AQYCAQMA; refresh_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5NzQ3MGQzMS0yYjE5LTQzMDItYjA4My1jYjI1ZGFmMWVkYmIiLCJqdGkiOiI5ZGFjZDRkOC02NGNhLTQ4NDgtYTQzNS04MTA2ZWU4ZjZlNDEiLCJ0eXBlIjoicmVmcmVzaCIsImlhdCI6MTc4MDA2OTIxNywiZXhwIjoxNzgyNjYxMjE3fQ.MGcdlq6F4NHwWQuyKHwhOna833s2fjxNTHkc4XxDg70; ab_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5NzQ3MGQzMS0yYjE5LTQzMDItYjA4My1jYjI1ZGFmMWVkYmIiLCJlbWFpbCI6ImhpYWdvYnJhbWJhdHRpQGdtYWlsLmNvbSIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzgwMDg1MTUxLCJleHAiOjE3ODA2ODk5NTF9.vw9V_qUUDMNmlIdOwG-f_7pv_eqvjVMqZehHSY6tSXw' \
  -H 'origin: https://www.maskai.co' \
  -H 'pragma: no-cache' \
  -H 'priority: u=1, i' \
  -H 'referer: https://www.maskai.co/' \
  -H 'sec-ch-ua: "Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-site' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

  curl 'https://api.maskai.co/api/process-video' \
  -X 'OPTIONS' \
  -H 'accept: */*' \
  -H 'accept-language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6,zh-CN;q=0.5,zh;q=0.4' \
  -H 'access-control-request-headers: content-type' \
  -H 'access-control-request-method: POST' \
  -H 'cache-control: no-cache' \
  -H 'origin: https://www.maskai.co' \
  -H 'pragma: no-cache' \
  -H 'priority: u=1, i' \
  -H 'referer: https://www.maskai.co/' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-site' \
  -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
- (opcional) `nosso.<ext>` — a saída do nosso modo Máximo pro mesmo input.
curl 'https://camufladorzetsu.com/api/camouflage/jobs' \
  -H 'Accept: */*' \
  -H 'Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6,zh-CN;q=0.5,zh;q=0.4' \
  -H 'Cache-Control: no-cache' \
  -H 'Connection: keep-alive' \
  -b 'sb-bstifptsildrelkdlnaz-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJleUpoYkdjaU9pSkZVekkxTmlJc0ltdHBaQ0k2SWpNM05XRXdZamRrTFRBNU9Ea3RORGt3T1MxaVpqVTRMVEUxTldZNU1HWXhPV1JpTkNJc0luUjVjQ0k2SWtwWFZDSjkuZXlKcGMzTWlPaUpvZEhSd2N6b3ZMMkp6ZEdsbWNIUnphV3hrY21Wc2EyUnNibUY2TG5OMWNHRmlZWE5sTG1OdkwyRjFkR2d2ZGpFaUxDSnpkV0lpT2lJMk5URmpNbVU1TmkwNE1EZGxMVFExWldZdE9XTTRNaTA1TkRVNU9HUTNOekJsTUdZaUxDSmhkV1FpT2lKaGRYUm9aVzUwYVdOaGRHVmtJaXdpWlhod0lqb3hOemd3TURnM01USXhMQ0pwWVhRaU9qRTNPREF3T0RNMU1qRXNJbVZ0WVdsc0lqb2lhR2xoWjI5aWNtRnRZbUYwZEdsQVoyMWhhV3d1WTI5dElpd2ljR2h2Ym1VaU9pSWlMQ0poY0hCZmJXVjBZV1JoZEdFaU9uc2ljSEp2ZG1sa1pYSWlPaUpsYldGcGJDSXNJbkJ5YjNacFpHVnljeUk2V3lKbGJXRnBiQ0pkZlN3aWRYTmxjbDl0WlhSaFpHRjBZU0k2ZXlKbGJXRnBiQ0k2SW1ocFlXZHZZbkpoYldKaGRIUnBRR2R0WVdsc0xtTnZiU0lzSW1WdFlXbHNYM1psY21sbWFXVmtJanBtWVd4elpTd2ljR2h2Ym1VaU9pSXJORGM1T1RJM05Ua3hPVElpTENKd2FHOXVaVjkyWlhKcFptbGxaQ0k2Wm1Gc2MyVXNJbk4xWWlJNklqWTFNV015WlRrMkxUZ3dOMlV0TkRWbFppMDVZemd5TFRrME5UazRaRGMzTUdVd1ppSjlMQ0p5YjJ4bElqb2lZWFYwYUdWdWRHbGpZWFJsWkNJc0ltRmhiQ0k2SW1GaGJERWlMQ0poYlhJaU9sdDdJbTFsZEdodlpDSTZJbkJoYzNOM2IzSmtJaXdpZEdsdFpYTjBZVzF3SWpveE56Z3dNREF5TmpFeWZWMHNJbk5sYzNOcGIyNWZhV1FpT2lJeU9URm1aV1UxTnkweFkyWmlMVFJoTmpjdE9URmpZaTFoTmpNMlpHRmpaamsyTkRFaUxDSnBjMTloYm05dWVXMXZkWE1pT21aaGJITmxmUS5MNWtQc1NrTV9ZTDBVYUNuZS1LQUhpN2RXSklJcXNCSlMwMm1pSVBrUDczUmtVc05KM0tHcW01SGdmVTRpZkpnS2pfT19hbkI1YXJPY0lmbEpDbjRSQSIsInRva2VuX3R5cGUiOiJiZWFyZXIiLCJleHBpcmVzX2luIjozNjAwLCJleHBpcmVzX2F0IjoxNzgwMDg3MTIxLCJyZWZyZXNoX3Rva2VuIjoiZGVsM21heW53eHFhIiwidXNlciI6eyJpZCI6IjY1MWMyZTk2LTgwN2UtNDVlZi05YzgyLTk0NTk4ZDc3MGUwZiIsImF1ZCI6ImF1dGhlbnRpY2F0ZWQiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImVtYWlsIjoiaGlhZ29icmFtYmF0dGlAZ21haWwuY29tIiwiZW1haWxfY29uZmlybWVkX2F0IjoiMjAyNi0wNC0yOFQyMDoxNTowNC41OTM3ODRaIiwicGhvbmUiOiIiLCJjb25maXJtYXRpb25fc2VudF9hdCI6IjIwMjYtMDQtMjhUMTc6Mjk6MjYuNDQzNDA4WiIsImNvbmZpcm1lZF9hdCI6IjIwMjYtMDQtMjhUMjA6MTU6MDQuNTkzNzg0WiIsImxhc3Rfc2lnbl9pbl9hdCI6IjIwMjYtMDUtMjhUMjE6MTA6MTIuNDg3NjZaIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJoaWFnb2JyYW1iYXR0aUBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6ZmFsc2UsInBob25lIjoiKzQ3OTkyNzU5MTkyIiwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiI2NTFjMmU5Ni04MDdlLTQ1ZWYtOWM4Mi05NDU5OGQ3NzBlMGYifSwiaWRlbnRpdGllcyI6W3siaWRlbnRpdHlfaWQiOiI1NDUxZjcwMi1jY2I2LTQwZjQtYWY1YS0wOGJjMGUwOTNiMzYiLCJpZCI6IjY1MWMyZTk2LTgwN2UtNDVlZi05YzgyLTk0NTk4ZDc3MGUwZiIsInVzZXJfaWQiOiI2NTFjMmU5Ni04MDdlLTQ1ZWYtOWM4Mi05NDU5OGQ3NzBlMGYiLCJpZGVudGl0eV9kYXRhIjp7ImVtYWlsIjoiaGlhZ29icmFtYmF0dGlAZ21haWwuY29tIiwiZW1haWxfdmVyaWZpZWQiOmZhbHNlLCJwaG9uZSI6Iis0Nzk5Mjc1OTE5MiIsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiNjUxYzJlOTYtODA3ZS00NWVmLTljODItOTQ1OThkNzcwZTBmIn0sInByb3ZpZGVyIjoiZW1haWwiLCJsYXN0X3NpZ25faW5fYXQiOiIyMDI2LTA0LTI4VDE3OjI5OjI2LjQzMDQ0MloiLCJjcmVhdGVkX2F0IjoiMjAyNi0wNC0yOFQxNzoyOToyNi40MzA0OTZaIiwidXBkYXRlZF9hdCI6IjIwMjYtMDQtMjhUMTc6Mjk6MjYuNDMwNDk2WiIsImVtYWlsIjoiaGlhZ29icmFtYmF0dGlAZ21haWwuY29tIn1dLCJjcmVhdGVkX2F0IjoiMjAyNi0wNC0yOFQxNzoyOToyNi4zOTY3MDNaIiwidXBkYXRlZF9hdCI6IjIwMjYtMDUtMjlUMTk6Mzg6NDEuNzI2MDQzWiIsImlzX2Fub255bW91cyI6ZmFsc2V9fQ' \
  -H 'Pragma: no-cache' \
  -H 'Referer: https://camufladorzetsu.com/dashboard' \
  -H 'Sec-Fetch-Dest: empty' \
  -H 'Sec-Fetch-Mode: cors' \
  -H 'Sec-Fetch-Site: same-origin' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36' \
  -H 'sec-ch-ua: "Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Windows"'
Os arquivos de mídia são ignorados pelo git (ver `.gitignore`).
