(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // node_modules/@capacitor/core/dist/index.js
  var ExceptionCode, CapacitorException, getPlatformId, createCapacitor, initCapacitorGlobal, Capacitor, registerPlugin, WebPlugin, encode, decode, CapacitorCookiesPluginWeb, CapacitorCookies, readBlobAsBase64, normalizeHttpHeaders, buildUrlParams, buildRequestInit, CapacitorHttpPluginWeb, CapacitorHttp, SystemBarsStyle, SystemBarType, SystemBarsPluginWeb, SystemBars;
  var init_dist = __esm({
    "node_modules/@capacitor/core/dist/index.js"() {
      (function(ExceptionCode2) {
        ExceptionCode2["Unimplemented"] = "UNIMPLEMENTED";
        ExceptionCode2["Unavailable"] = "UNAVAILABLE";
      })(ExceptionCode || (ExceptionCode = {}));
      CapacitorException = class extends Error {
        constructor(message, code, data) {
          super(message);
          this.message = message;
          this.code = code;
          this.data = data;
        }
      };
      getPlatformId = (win) => {
        var _a, _b;
        if (win === null || win === void 0 ? void 0 : win.androidBridge) {
          return "android";
        } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
          return "ios";
        } else {
          return "web";
        }
      };
      createCapacitor = (win) => {
        const capCustomPlatform = win.CapacitorCustomPlatform || null;
        const cap = win.Capacitor || {};
        const Plugins = cap.Plugins = cap.Plugins || {};
        const getPlatform = () => {
          return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
        };
        const isNativePlatform = () => getPlatform() !== "web";
        const isPluginAvailable = (pluginName) => {
          const plugin = registeredPlugins.get(pluginName);
          if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
            return true;
          }
          if (getPluginHeader(pluginName)) {
            return true;
          }
          return false;
        };
        const getPluginHeader = (pluginName) => {
          var _a;
          return (_a = cap.PluginHeaders) === null || _a === void 0 ? void 0 : _a.find((h) => h.name === pluginName);
        };
        const handleError = (err) => win.console.error(err);
        const registeredPlugins = /* @__PURE__ */ new Map();
        const registerPlugin2 = (pluginName, jsImplementations = {}) => {
          const registeredPlugin = registeredPlugins.get(pluginName);
          if (registeredPlugin) {
            console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
            return registeredPlugin.proxy;
          }
          const platform = getPlatform();
          const pluginHeader = getPluginHeader(pluginName);
          let jsImplementation;
          const loadPluginImplementation = async () => {
            if (!jsImplementation && platform in jsImplementations) {
              jsImplementation = typeof jsImplementations[platform] === "function" ? jsImplementation = await jsImplementations[platform]() : jsImplementation = jsImplementations[platform];
            } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
              jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
            }
            return jsImplementation;
          };
          const createPluginMethod = (impl, prop) => {
            var _a, _b;
            if (pluginHeader) {
              const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
              if (methodHeader) {
                if (methodHeader.rtype === "promise") {
                  return (options) => cap.nativePromise(pluginName, prop.toString(), options);
                } else {
                  return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
                }
              } else if (impl) {
                return (_a = impl[prop]) === null || _a === void 0 ? void 0 : _a.bind(impl);
              }
            } else if (impl) {
              return (_b = impl[prop]) === null || _b === void 0 ? void 0 : _b.bind(impl);
            } else {
              throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform}`, ExceptionCode.Unimplemented);
            }
          };
          const createPluginMethodWrapper = (prop) => {
            let remove;
            const wrapper = (...args) => {
              const p = loadPluginImplementation().then((impl) => {
                const fn = createPluginMethod(impl, prop);
                if (fn) {
                  const p2 = fn(...args);
                  remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
                  return p2;
                } else {
                  throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform}`, ExceptionCode.Unimplemented);
                }
              });
              if (prop === "addListener") {
                p.remove = async () => remove();
              }
              return p;
            };
            wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
            Object.defineProperty(wrapper, "name", {
              value: prop,
              writable: false,
              configurable: false
            });
            return wrapper;
          };
          const addListener = createPluginMethodWrapper("addListener");
          const removeListener = createPluginMethodWrapper("removeListener");
          const addListenerNative = (eventName, callback) => {
            const call = addListener({ eventName }, callback);
            const remove = async () => {
              const callbackId = await call;
              removeListener({
                eventName,
                callbackId
              }, callback);
            };
            const p = new Promise((resolve) => call.then(() => resolve({ remove })));
            p.remove = async () => {
              console.warn(`Using addListener() without 'await' is deprecated.`);
              await remove();
            };
            return p;
          };
          const proxy = new Proxy({}, {
            get(_, prop) {
              switch (prop) {
                // https://github.com/facebook/react/issues/20030
                case "$$typeof":
                  return void 0;
                case "toJSON":
                  return () => ({});
                case "addListener":
                  return pluginHeader ? addListenerNative : addListener;
                case "removeListener":
                  return removeListener;
                default:
                  return createPluginMethodWrapper(prop);
              }
            }
          });
          Plugins[pluginName] = proxy;
          registeredPlugins.set(pluginName, {
            name: pluginName,
            proxy,
            platforms: /* @__PURE__ */ new Set([...Object.keys(jsImplementations), ...pluginHeader ? [platform] : []])
          });
          return proxy;
        };
        if (!cap.convertFileSrc) {
          cap.convertFileSrc = (filePath) => filePath;
        }
        cap.getPlatform = getPlatform;
        cap.handleError = handleError;
        cap.isNativePlatform = isNativePlatform;
        cap.isPluginAvailable = isPluginAvailable;
        cap.registerPlugin = registerPlugin2;
        cap.Exception = CapacitorException;
        cap.DEBUG = !!cap.DEBUG;
        cap.isLoggingEnabled = !!cap.isLoggingEnabled;
        return cap;
      };
      initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
      Capacitor = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      registerPlugin = Capacitor.registerPlugin;
      WebPlugin = class {
        constructor() {
          this.listeners = {};
          this.retainedEventArguments = {};
          this.windowListeners = {};
        }
        addListener(eventName, listenerFunc) {
          let firstListener = false;
          const listeners = this.listeners[eventName];
          if (!listeners) {
            this.listeners[eventName] = [];
            firstListener = true;
          }
          this.listeners[eventName].push(listenerFunc);
          const windowListener = this.windowListeners[eventName];
          if (windowListener && !windowListener.registered) {
            this.addWindowListener(windowListener);
          }
          if (firstListener) {
            this.sendRetainedArgumentsForEvent(eventName);
          }
          const remove = async () => this.removeListener(eventName, listenerFunc);
          const p = Promise.resolve({ remove });
          return p;
        }
        async removeAllListeners() {
          this.listeners = {};
          for (const listener in this.windowListeners) {
            this.removeWindowListener(this.windowListeners[listener]);
          }
          this.windowListeners = {};
        }
        notifyListeners(eventName, data, retainUntilConsumed) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            if (retainUntilConsumed) {
              let args = this.retainedEventArguments[eventName];
              if (!args) {
                args = [];
              }
              args.push(data);
              this.retainedEventArguments[eventName] = args;
            }
            return;
          }
          listeners.forEach((listener) => listener(data));
        }
        hasListeners(eventName) {
          var _a;
          return !!((_a = this.listeners[eventName]) === null || _a === void 0 ? void 0 : _a.length);
        }
        registerWindowListener(windowEventName, pluginEventName) {
          this.windowListeners[pluginEventName] = {
            registered: false,
            windowEventName,
            pluginEventName,
            handler: (event) => {
              this.notifyListeners(pluginEventName, event);
            }
          };
        }
        unimplemented(msg = "not implemented") {
          return new Capacitor.Exception(msg, ExceptionCode.Unimplemented);
        }
        unavailable(msg = "not available") {
          return new Capacitor.Exception(msg, ExceptionCode.Unavailable);
        }
        async removeListener(eventName, listenerFunc) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            return;
          }
          const index = listeners.indexOf(listenerFunc);
          if (index !== -1) {
            this.listeners[eventName].splice(index, 1);
          }
          if (!this.listeners[eventName].length) {
            this.removeWindowListener(this.windowListeners[eventName]);
          }
        }
        addWindowListener(handle) {
          window.addEventListener(handle.windowEventName, handle.handler);
          handle.registered = true;
        }
        removeWindowListener(handle) {
          if (!handle) {
            return;
          }
          window.removeEventListener(handle.windowEventName, handle.handler);
          handle.registered = false;
        }
        sendRetainedArgumentsForEvent(eventName) {
          const args = this.retainedEventArguments[eventName];
          if (!args) {
            return;
          }
          delete this.retainedEventArguments[eventName];
          args.forEach((arg) => {
            this.notifyListeners(eventName, arg);
          });
        }
      };
      encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
      decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
      CapacitorCookiesPluginWeb = class extends WebPlugin {
        async getCookies() {
          const cookies = document.cookie;
          const cookieMap = {};
          cookies.split(";").forEach((cookie) => {
            if (cookie.length <= 0)
              return;
            let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
            key = decode(key).trim();
            value = decode(value).trim();
            cookieMap[key] = value;
          });
          return cookieMap;
        }
        async setCookie(options) {
          try {
            const encodedKey = encode(options.key);
            const encodedValue = encode(options.value);
            const expires = options.expires ? `; expires=${options.expires.replace("expires=", "")}` : "";
            const path = (options.path || "/").replace("path=", "");
            const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
            document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path}; ${domain};`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async deleteCookie(options) {
          try {
            document.cookie = `${options.key}=; Max-Age=0`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearCookies() {
          try {
            const cookies = document.cookie.split(";") || [];
            for (const cookie of cookies) {
              document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
            }
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearAllCookies() {
          try {
            await this.clearCookies();
          } catch (error) {
            return Promise.reject(error);
          }
        }
      };
      CapacitorCookies = registerPlugin("CapacitorCookies", {
        web: () => new CapacitorCookiesPluginWeb()
      });
      readBlobAsBase64 = async (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64String = reader.result;
          resolve(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
      });
      normalizeHttpHeaders = (headers = {}) => {
        const originalKeys = Object.keys(headers);
        const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
        const normalized = loweredKeys.reduce((acc, key, index) => {
          acc[key] = headers[originalKeys[index]];
          return acc;
        }, {});
        return normalized;
      };
      buildUrlParams = (params, shouldEncode = true) => {
        if (!params)
          return null;
        const output = Object.entries(params).reduce((accumulator, entry) => {
          const [key, value] = entry;
          let encodedValue;
          let item;
          if (Array.isArray(value)) {
            item = "";
            value.forEach((str) => {
              encodedValue = shouldEncode ? encodeURIComponent(str) : str;
              item += `${key}=${encodedValue}&`;
            });
            item.slice(0, -1);
          } else {
            encodedValue = shouldEncode ? encodeURIComponent(value) : value;
            item = `${key}=${encodedValue}`;
          }
          return `${accumulator}&${item}`;
        }, "");
        return output.substr(1);
      };
      buildRequestInit = (options, extra = {}) => {
        const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
        const headers = normalizeHttpHeaders(options.headers);
        const type = headers["content-type"] || "";
        if (typeof options.data === "string") {
          output.body = options.data;
        } else if (type.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(options.data || {})) {
            params.set(key, value);
          }
          output.body = params.toString();
        } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
          const form = new FormData();
          if (options.data instanceof FormData) {
            options.data.forEach((value, key) => {
              form.append(key, value);
            });
          } else {
            for (const key of Object.keys(options.data)) {
              form.append(key, options.data[key]);
            }
          }
          output.body = form;
          const headers2 = new Headers(output.headers);
          headers2.delete("content-type");
          output.headers = headers2;
        } else if (type.includes("application/json") || typeof options.data === "object") {
          output.body = JSON.stringify(options.data);
        }
        return output;
      };
      CapacitorHttpPluginWeb = class extends WebPlugin {
        /**
         * Perform an Http request given a set of options
         * @param options Options to build the HTTP request
         */
        async request(options) {
          const requestInit = buildRequestInit(options, options.webFetchExtra);
          const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
          const url = urlParams ? `${options.url}?${urlParams}` : options.url;
          const response = await fetch(url, requestInit);
          const contentType = response.headers.get("content-type") || "";
          let { responseType = "text" } = response.ok ? options : {};
          if (contentType.includes("application/json")) {
            responseType = "json";
          }
          let data;
          let blob;
          switch (responseType) {
            case "arraybuffer":
            case "blob":
              blob = await response.blob();
              data = await readBlobAsBase64(blob);
              break;
            case "json":
              data = await response.json();
              break;
            case "document":
            case "text":
            default:
              data = await response.text();
          }
          const headers = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          return {
            data,
            headers,
            status: response.status,
            url: response.url
          };
        }
        /**
         * Perform an Http GET request given a set of options
         * @param options Options to build the HTTP request
         */
        async get(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
        }
        /**
         * Perform an Http POST request given a set of options
         * @param options Options to build the HTTP request
         */
        async post(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
        }
        /**
         * Perform an Http PUT request given a set of options
         * @param options Options to build the HTTP request
         */
        async put(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
        }
        /**
         * Perform an Http PATCH request given a set of options
         * @param options Options to build the HTTP request
         */
        async patch(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
        }
        /**
         * Perform an Http DELETE request given a set of options
         * @param options Options to build the HTTP request
         */
        async delete(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
        }
      };
      CapacitorHttp = registerPlugin("CapacitorHttp", {
        web: () => new CapacitorHttpPluginWeb()
      });
      (function(SystemBarsStyle2) {
        SystemBarsStyle2["Dark"] = "DARK";
        SystemBarsStyle2["Light"] = "LIGHT";
        SystemBarsStyle2["Default"] = "DEFAULT";
      })(SystemBarsStyle || (SystemBarsStyle = {}));
      (function(SystemBarType2) {
        SystemBarType2["StatusBar"] = "StatusBar";
        SystemBarType2["NavigationBar"] = "NavigationBar";
      })(SystemBarType || (SystemBarType = {}));
      SystemBarsPluginWeb = class extends WebPlugin {
        async setStyle() {
          this.unavailable("not available for web");
        }
        async setAnimation() {
          this.unavailable("not available for web");
        }
        async show() {
          this.unavailable("not available for web");
        }
        async hide() {
          this.unavailable("not available for web");
        }
      };
      SystemBars = registerPlugin("SystemBars", {
        web: () => new SystemBarsPluginWeb()
      });
    }
  });

  // node_modules/@bglocation/capacitor/dist/esm/definitions.js
  var GEOFENCE_MAX_COUNT;
  var init_definitions = __esm({
    "node_modules/@bglocation/capacitor/dist/esm/definitions.js"() {
      GEOFENCE_MAX_COUNT = 20;
    }
  });

  // node_modules/@bglocation/capacitor/dist/esm/web.js
  var web_exports = {};
  __export(web_exports, {
    BackgroundLocationWeb: () => BackgroundLocationWeb
  });
  var BackgroundLocationWeb;
  var init_web = __esm({
    "node_modules/@bglocation/capacitor/dist/esm/web.js"() {
      init_dist();
      init_definitions();
      BackgroundLocationWeb = class extends WebPlugin {
        constructor() {
          super(...arguments);
          __publicField(this, "watchId", null);
          __publicField(this, "heartbeatTimer", null);
          __publicField(this, "config", null);
          __publicField(this, "httpConfig", null);
          __publicField(this, "isTracking", false);
          __publicField(this, "debug", false);
          __publicField(this, "locationCount", 0);
          __publicField(this, "heartbeatCount", 0);
          __publicField(this, "httpSuccessCount", 0);
          __publicField(this, "httpErrorCount", 0);
          __publicField(this, "geofenceStore", /* @__PURE__ */ new Map());
        }
        async getVersion() {
          return { pluginVersion: "1.1.0", coreVersion: "web" };
        }
        async checkPermissions() {
          const result = await navigator.permissions.query({ name: "geolocation" });
          const state = result.state === "granted" ? "granted" : result.state === "denied" ? "denied" : "prompt";
          return { location: state, backgroundLocation: state };
        }
        async requestPermissions() {
          return this.checkPermissions();
        }
        async configure(options) {
          this.config = options;
          this.httpConfig = options.http ?? null;
          this.debug = options.debug ?? false;
          this.resetCounters();
          const distanceFilter = options.distanceFilter ?? 15;
          const heartbeatInterval = options.heartbeatInterval ?? 15;
          const distanceFilterMode = distanceFilter === "auto" ? "auto" : "fixed";
          if (distanceFilter === "auto") {
            this.emitDebug("CONFIGURE distanceFilter=auto ignored on Web \u2014 browser does not support native distance filtering");
          }
          this.emitDebug(`CONFIGURE distance=${distanceFilter}m heartbeat=${heartbeatInterval}s http=${options.http?.url ?? "disabled"}`);
          console.info("[BackgroundLocation:web] configured", options);
          return { licenseMode: "full", distanceFilterMode };
        }
        async start() {
          if (!this.config) {
            throw new Error("Plugin not configured. Call configure() first.");
          }
          this.watchId = navigator.geolocation.watchPosition((position) => {
            const location = this.geolocationToLocation(position);
            this.notifyListeners("onLocation", location);
            this.locationCount++;
            this.emitDebug(`LOCATION #${this.locationCount} (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}) acc=${location.accuracy.toFixed(1)}m`);
            this.sendHttp(location);
          }, (error) => {
            console.error("[BackgroundLocation:web] watch error:", error.message);
          }, {
            enableHighAccuracy: (this.config.desiredAccuracy ?? "high") === "high",
            maximumAge: 1e3,
            timeout: 2e4
          });
          this.startHeartbeat();
          this.isTracking = true;
          this.resetCounters();
          this.emitDebug("START tracking");
          return { enabled: true, tracking: true };
        }
        async stop() {
          if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
          }
          this.stopHeartbeat();
          this.isTracking = false;
          this.emitDebug(`STOP tracking \u2014 locations=${this.locationCount} heartbeats=${this.heartbeatCount} http_ok=${this.httpSuccessCount} http_err=${this.httpErrorCount}`);
          const permissions = await this.checkPermissions();
          return { enabled: permissions.location === "granted", tracking: false };
        }
        async getState() {
          const permissions = await this.checkPermissions();
          return { enabled: permissions.location === "granted", tracking: this.isTracking };
        }
        async removeAllListeners() {
          if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
          }
          this.stopHeartbeat();
          this.isTracking = false;
          await super.removeAllListeners();
        }
        async getCurrentPosition(options) {
          return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition((position) => resolve(this.geolocationToLocation(position)), (error) => reject(new Error(error.message)), { enableHighAccuracy: true, timeout: options?.timeout ?? 2e4 });
          });
        }
        // B.1: Battery optimization — no-op on Web (not applicable to browsers)
        async checkBatteryOptimization() {
          return {
            isIgnoringOptimizations: true,
            manufacturer: "",
            helpUrl: "",
            message: "Battery optimization is not applicable on Web platform."
          };
        }
        async requestBatteryOptimization() {
          return this.checkBatteryOptimization();
        }
        // -----------------------------------------------------------------------
        // Geofencing — in-memory stub for development/testing
        // -----------------------------------------------------------------------
        async addGeofence(geofence) {
          if (this.geofenceStore.size >= GEOFENCE_MAX_COUNT && !this.geofenceStore.has(geofence.identifier)) {
            throw new Error(`Geofence limit reached (max ${GEOFENCE_MAX_COUNT})`);
          }
          this.geofenceStore.set(geofence.identifier, { ...geofence });
          this.emitDebug(`[GEOFENCE ADD] "${geofence.identifier}" (${this.geofenceStore.size}/${GEOFENCE_MAX_COUNT})`);
        }
        async addGeofences(options) {
          for (const geofence of options.geofences) {
            await this.addGeofence(geofence);
          }
        }
        async removeGeofence(options) {
          if (!this.geofenceStore.has(options.identifier)) {
            throw new Error(`Geofence "${options.identifier}" not found`);
          }
          this.geofenceStore.delete(options.identifier);
          this.emitDebug(`[GEOFENCE REMOVE] "${options.identifier}" (${this.geofenceStore.size}/${GEOFENCE_MAX_COUNT})`);
        }
        async removeAllGeofences() {
          const count = this.geofenceStore.size;
          this.geofenceStore.clear();
          this.emitDebug(`[GEOFENCE REMOVE_ALL] removed ${count}`);
        }
        async getGeofences() {
          return { geofences: Array.from(this.geofenceStore.values()) };
        }
        startHeartbeat() {
          if (!this.config)
            return;
          this.heartbeatTimer = setInterval(() => {
            navigator.geolocation.getCurrentPosition((position) => {
              const location = this.geolocationToLocation(position);
              this.notifyListeners("onHeartbeat", { location, timestamp: Date.now() });
              this.heartbeatCount++;
              this.emitDebug(`HEARTBEAT #${this.heartbeatCount} with location`);
            }, (_error) => {
              this.notifyListeners("onHeartbeat", { location: null, timestamp: Date.now() });
              this.heartbeatCount++;
              this.emitDebug(`HEARTBEAT #${this.heartbeatCount} no location`);
            });
          }, (this.config.heartbeatInterval ?? 15) * 1e3);
        }
        stopHeartbeat() {
          if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
          }
        }
        geolocationToLocation(position) {
          return {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed ?? 0,
            heading: position.coords.heading ?? -1,
            altitude: position.coords.altitude ?? 0,
            timestamp: position.timestamp,
            isMoving: (position.coords.speed ?? 0) > 0.5,
            isMock: false
          };
        }
        sendHttp(location) {
          if (!this.httpConfig)
            return;
          const headers = {
            "Content-Type": "application/json",
            ...this.httpConfig.headers ?? {}
          };
          fetch(this.httpConfig.url, {
            method: "POST",
            headers,
            body: JSON.stringify({ location })
          }).then(async (response) => {
            const responseText = await response.text().catch(() => "");
            if (response.ok) {
              this.httpSuccessCount++;
              this.emitDebug(`HTTP OK #${this.httpSuccessCount} status=${response.status}`);
            } else {
              this.httpErrorCount++;
              this.emitDebug(`HTTP ERROR #${this.httpErrorCount} status=${response.status}`);
            }
            this.notifyListeners("onHttp", {
              statusCode: response.status,
              success: response.ok,
              responseText,
              bufferedCount: 0
            });
          }).catch((error) => {
            this.httpErrorCount++;
            this.emitDebug(`HTTP ERROR #${this.httpErrorCount} status=0 error=${error.message}`);
            this.notifyListeners("onHttp", {
              statusCode: 0,
              success: false,
              responseText: "",
              error: error.message,
              bufferedCount: 0
            });
          });
        }
        emitDebug(message) {
          if (!this.debug)
            return;
          console.debug(`[BGL_DEBUG] ${message}`);
          this.notifyListeners("onDebug", { message, timestamp: Date.now() });
        }
        resetCounters() {
          this.locationCount = 0;
          this.heartbeatCount = 0;
          this.httpSuccessCount = 0;
          this.httpErrorCount = 0;
        }
      };
    }
  });

  // node_modules/@bglocation/capacitor/dist/esm/index.js
  var RawPlugin, lastConfig, BackgroundLocation;
  var init_esm = __esm({
    "node_modules/@bglocation/capacitor/dist/esm/index.js"() {
      init_dist();
      init_definitions();
      RawPlugin = registerPlugin("BackgroundLocation", {
        web: () => Promise.resolve().then(() => (init_web(), web_exports)).then((m) => new m.BackgroundLocationWeb())
      });
      BackgroundLocation = new Proxy(RawPlugin, {
        get(target, prop, receiver) {
          if (prop === "configure") {
            return async (options) => {
              const merged = lastConfig ? { ...lastConfig, ...options } : options;
              const result = await target.configure(merged);
              lastConfig = merged;
              return result;
            };
          }
          return Reflect.get(target, prop, receiver);
        }
      });
    }
  });

  // scripts/background-location.js
  var require_background_location = __commonJS({
    "scripts/background-location.js"() {
      init_esm();
      window.BackgroundLocation = BackgroundLocation;
    }
  });
  require_background_location();
})();
/*! Bundled license information:

@capacitor/core/dist/index.js:
  (*! Capacitor: https://capacitorjs.com/ - MIT License *)
*/
