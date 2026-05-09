var _sentryDebugIds,_sentryDebugIdIdentifier;void 0===_sentryDebugIds&&(_sentryDebugIds={});try{var stack=(new Error).stack;stack&&(_sentryDebugIds[stack]="840ebe36-a7ed-4c02-8fe8-455af50b934c",_sentryDebugIdIdentifier="sentry-dbid-840ebe36-a7ed-4c02-8fe8-455af50b934c")}catch(e){}
var SENTRY_RELEASE;SENTRY_RELEASE={name: "CommunityBridge", version: "1.0.1"};
__d(function(g,r,i,a,m,e,d){"use strict";Object.defineProperty(e,'__esModule',{value:!0});var t=r(d[0]);Object.keys(t).forEach(function(n){'default'===n||Object.prototype.hasOwnProperty.call(e,n)||Object.defineProperty(e,n,{enumerable:!0,get:function(){return t[n]}})})},1733,[1734]);
__d(function(g,r,i,a,m,_e2,d){"use strict";Object.defineProperty(_e2,'__esModule',{value:!0}),Object.defineProperty(_e2,"CustomProvider",{enumerable:!0,get:function(){return we}}),Object.defineProperty(_e2,"ReCaptchaEnterpriseProvider",{enumerable:!0,get:function(){return ke}}),Object.defineProperty(_e2,"ReCaptchaV3Provider",{enumerable:!0,get:function(){return ge}}),Object.defineProperty(_e2,"getLimitedUseToken",{enumerable:!0,get:function(){return _e}}),Object.defineProperty(_e2,"getToken",{enumerable:!0,get:function(){return ye}}),Object.defineProperty(_e2,"initializeAppCheck",{enumerable:!0,get:function(){return be}}),Object.defineProperty(_e2,"onTokenChanged",{enumerable:!0,get:function(){return Pe}}),Object.defineProperty(_e2,"setTokenAutoRefreshEnabled",{enumerable:!0,get:function(){return Ee}});var e=r(d[0]),t=r(d[1]),n=r(d[2]),o=r(d[3]);
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
const s=new Map,c={activated:!1,tokenObservers:[]},l={initialized:!1,enabled:!1};function u(e){return s.get(e)||Object.assign({},c)}function h(e,t){return s.set(e,t),s.get(e)}function p(){return l}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const f='https://content-firebaseappcheck.googleapis.com/v1',k='exchangeDebugToken',w={OFFSET_DURATION:3e5,RETRIAL_MIN_WAIT:3e4,RETRIAL_MAX_WAIT:96e4};
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
class v{constructor(e,t,n,o,s){if(this.operation=e,this.retryPolicy=t,this.getWaitDuration=n,this.lowerBound=o,this.upperBound=s,this.pending=null,this.nextErrorWaitInterval=o,o>s)throw new Error('Proactive refresh lower bound greater than upper bound!')}start(){this.nextErrorWaitInterval=this.lowerBound,this.process(!0).catch(()=>{})}stop(){this.pending&&(this.pending.reject('cancelled'),this.pending=null)}isRunning(){return!!this.pending}async process(e){this.stop();try{this.pending=new n.Deferred,this.pending.promise.catch(e=>{}),await(t=this.getNextRun(e),new Promise(e=>{setTimeout(e,t)})),this.pending.resolve(),await this.pending.promise,this.pending=new n.Deferred,this.pending.promise.catch(e=>{}),await this.operation(),this.pending.resolve(),await this.pending.promise,this.process(!0).catch(()=>{})}catch(e){this.retryPolicy(e)?this.process(!1).catch(()=>{}):this.stop()}var t;
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */}getNextRun(e){if(e)return this.nextErrorWaitInterval=this.lowerBound,this.getWaitDuration();{const e=this.nextErrorWaitInterval;return this.nextErrorWaitInterval*=2,this.nextErrorWaitInterval>this.upperBound&&(this.nextErrorWaitInterval=this.upperBound),e}}}const b={"already-initialized":"You have already called initializeAppCheck() for FirebaseApp {$appName} with different options. To avoid this error, call initializeAppCheck() with the same options as when it was originally called. This will return the already initialized instance.","use-before-activation":"App Check is being used before initializeAppCheck() is called for FirebaseApp {$appName}. Call initializeAppCheck() before instantiating other Firebase services.","fetch-network-error":"Fetch failed to connect to a network. Check Internet connection. Original error: {$originalErrorMessage}.","fetch-parse-error":"Fetch client could not parse response. Original error: {$originalErrorMessage}.","fetch-status-error":'Fetch server returned an HTTP error status. HTTP status: {$httpStatus}.',"storage-open":'Error thrown when opening storage. Original error: {$originalErrorMessage}.',"storage-get":'Error thrown when reading from storage. Original error: {$originalErrorMessage}.',"storage-set":'Error thrown when writing to storage. Original error: {$originalErrorMessage}.',"recaptcha-error":'ReCAPTCHA error.',throttled:"Requests throttled due to {$httpStatus} error. Attempts allowed again after {$time}"},T=new n.ErrorFactory('appCheck','AppCheck',b);
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */
function E(e=!1){var t;return e?null===(t=self.grecaptcha)||void 0===t?void 0:t.enterprise:self.grecaptcha}function y(e){if(!u(e).activated)throw T.create("use-before-activation",{appName:e.name})}function _(e){const t=Math.round(e/1e3),n=Math.floor(t/86400),o=Math.floor((t-3600*n*24)/3600),s=Math.floor((t-3600*n*24-3600*o)/60),c=t-3600*n*24-3600*o-60*s;let l='';return n&&(l+=P(n)+'d:'),o&&(l+=P(o)+'h:'),l+=P(s)+'m:'+P(c)+'s',l}function P(e){return 0===e?'00':e>=10?e.toString():'0'+e}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function A({url:e,body:t},n){const o={'Content-Type':'application/json'},s=n.getImmediate({optional:!0});if(s){const e=await s.getHeartbeatsHeader();e&&(o['X-Firebase-Client']=e)}const c={method:'POST',body:JSON.stringify(t),headers:o};let l,u;try{l=await fetch(e,c)}catch(e){throw T.create("fetch-network-error",{originalErrorMessage:null==e?void 0:e.message})}if(200!==l.status)throw T.create("fetch-status-error",{httpStatus:l.status});try{u=await l.json()}catch(e){throw T.create("fetch-parse-error",{originalErrorMessage:null==e?void 0:e.message})}const h=u.ttl.match(/^([\d.]+)(s)$/);if(!h||!h[2]||isNaN(Number(h[1])))throw T.create("fetch-parse-error",{originalErrorMessage:`ttl field (timeToLive) is not in standard Protobuf Duration format: ${u.ttl}`});const p=1e3*Number(h[1]),f=Date.now();return{token:u.token,expireTimeMillis:f+p,issuedAtTimeMillis:f}}function C(e,t){const{projectId:n,appId:o,apiKey:s}=e.options;return{url:`${f}/projects/${n}/apps/${o}:exchangeRecaptchaV3Token?key=${s}`,body:{recaptcha_v3_token:t}}}function I(e,t){const{projectId:n,appId:o,apiKey:s}=e.options;return{url:`${f}/projects/${n}/apps/${o}:exchangeRecaptchaEnterpriseToken?key=${s}`,body:{recaptcha_enterprise_token:t}}}function R(e,t){const{projectId:n,appId:o,apiKey:s}=e.options;return{url:`${f}/projects/${n}/apps/${o}:${k}?key=${s}`,body:{debug_token:t}}}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const D='firebase-app-check-database',S=1,O='firebase-app-check-store',x='debug-token';let M=null;function $(){return M||(M=new Promise((e,t)=>{try{const n=indexedDB.open(D,S);n.onsuccess=t=>{e(t.target.result)},n.onerror=e=>{var n;t(T.create("storage-open",{originalErrorMessage:null===(n=e.target.error)||void 0===n?void 0:n.message}))},n.onupgradeneeded=e=>{const t=e.target.result;if(0===e.oldVersion)t.createObjectStore(O,{keyPath:'compositeKey'})}}catch(e){t(T.create("storage-open",{originalErrorMessage:null==e?void 0:e.message}))}}),M)}function N(e){return z(K(e))}function j(e,t){return B(K(e),t)}async function B(e,t){const n=(await $()).transaction(O,'readwrite'),o=n.objectStore(O).put({compositeKey:e,value:t});return new Promise((e,t)=>{o.onsuccess=t=>{e()},n.onerror=e=>{var n;t(T.create("storage-set",{originalErrorMessage:null===(n=e.target.error)||void 0===n?void 0:n.message}))}})}async function z(e){const t=(await $()).transaction(O,'readonly'),n=t.objectStore(O).get(e);return new Promise((e,o)=>{n.onsuccess=t=>{const n=t.target.result;e(n?n.value:void 0)},t.onerror=e=>{var t;o(T.create("storage-get",{originalErrorMessage:null===(t=e.target.error)||void 0===t?void 0:t.message}))}})}function K(e){return`${e.options.appId}-${e.name}`}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const H=new o.Logger('@firebase/app-check');
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */async function F(e){if((0,n.isIndexedDBAvailable)()){let t;try{t=await N(e)}catch(e){H.warn(`Failed to read token from IndexedDB. Error: ${e}`)}return t}}function L(e,t){return(0,n.isIndexedDBAvailable)()?j(e,t).catch(e=>{H.warn(`Failed to write token to IndexedDB. Error: ${e}`)}):Promise.resolve()}async function W(){let e;try{e=await z(x)}catch(e){}if(e)return e;{const e=(0,n.uuidv4)();return(t=e,B(x,t)).catch(e=>H.warn(`Failed to persist debug token to IndexedDB. Error: ${e}`)),e}var t}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function q(){return p().enabled}async function U(){const e=p();if(e.enabled&&e.token)return e.token.promise;throw Error("\n            Can't get debug token in production mode.\n        ")}function X(){const e=(0,n.getGlobal)(),t=p();if(t.initialized=!0,'string'!=typeof e.FIREBASE_APPCHECK_DEBUG_TOKEN&&!0!==e.FIREBASE_APPCHECK_DEBUG_TOKEN)return;t.enabled=!0;const o=new n.Deferred;t.token=o,'string'==typeof e.FIREBASE_APPCHECK_DEBUG_TOKEN?o.resolve(e.FIREBASE_APPCHECK_DEBUG_TOKEN):o.resolve(W())}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */const G={error:'UNKNOWN_ERROR'};async function V(e,t=!1){const n=e.app;y(n);const o=u(n);let s,c=o.token;if(c&&!re(c)&&(o.token=void 0,c=void 0),!c){const e=await o.cachedTokenPromise;e&&(re(e)?c=e:await L(n,void 0))}if(!t&&c&&re(c))return{token:c.token};let l,h=!1;if(q()){o.exchangeTokenPromise||(o.exchangeTokenPromise=A(R(n,await U()),e.heartbeatServiceProvider).finally(()=>{o.exchangeTokenPromise=void 0}),h=!0);const t=await o.exchangeTokenPromise;return await L(n,t),o.token=t,{token:t.token}}try{o.exchangeTokenPromise||(o.exchangeTokenPromise=o.provider.getToken().finally(()=>{o.exchangeTokenPromise=void 0}),h=!0),c=await u(n).exchangeTokenPromise}catch(e){"appCheck/throttled"===e.code?H.warn(e.message):H.error(e),s=e}return c?s?l=re(c)?{token:c.token,internalError:s}:ne(s):(l={token:c.token},o.token=c,await L(n,c)):l=ne(s),h&&te(n,l),l}async function J(e){const t=e.app;y(t);const{provider:n}=u(t);if(q()){const n=await U(),{token:o}=await A(R(t,n),e.heartbeatServiceProvider);return{token:o}}{const{token:e}=await n.getToken();return{token:e}}}function Y(e,t,n,o){const{app:s}=e,c=u(s),l={next:n,error:o,type:t};if(c.tokenObservers=[...c.tokenObservers,l],c.token&&re(c.token)){const t=c.token;Promise.resolve().then(()=>{n({token:t.token}),Z(e)}).catch(()=>{})}c.cachedTokenPromise.then(()=>Z(e))}function Q(e,t){const n=u(e),o=n.tokenObservers.filter(e=>e.next!==t);0===o.length&&n.tokenRefresher&&n.tokenRefresher.isRunning()&&n.tokenRefresher.stop(),n.tokenObservers=o}function Z(e){const{app:t}=e,n=u(t);let o=n.tokenRefresher;o||(o=ee(e),n.tokenRefresher=o),!o.isRunning()&&n.isTokenAutoRefreshEnabled&&o.start()}function ee(e){const{app:t}=e;return new v(async()=>{let n;if(n=u(t).token?await V(e,!0):await V(e),n.error)throw n.error;if(n.internalError)throw n.internalError},()=>!0,()=>{const e=u(t);if(e.token){let t=e.token.issuedAtTimeMillis+.5*(e.token.expireTimeMillis-e.token.issuedAtTimeMillis)+3e5;const n=e.token.expireTimeMillis-3e5;return t=Math.min(t,n),Math.max(0,t-Date.now())}return 0},w.RETRIAL_MIN_WAIT,w.RETRIAL_MAX_WAIT)}function te(e,t){const n=u(e).tokenObservers;for(const e of n)try{"EXTERNAL"===e.type&&null!=t.error?e.error(t.error):e.next(t)}catch(e){}}function re(e){return e.expireTimeMillis-Date.now()>0}function ne(e){return{token:(t=G,n.base64.encodeString(JSON.stringify(t),!1)),error:e};var t}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class oe{constructor(e,t){this.app=e,this.heartbeatServiceProvider=t}_delete(){const{tokenObservers:e}=u(this.app);for(const t of e)Q(this.app,t.next);return Promise.resolve()}}function ie(e,t){return new oe(e,t)}function ae(e){return{getToken:t=>V(e,t),getLimitedUseToken:()=>J(e),addTokenListener:t=>Y(e,"INTERNAL",t),removeTokenListener:t=>Q(e.app,t)}}function se(e,t){const o=new n.Deferred;u(e).reCAPTCHAState={initialized:o};const s=ue(e),c=E(!1);return c?le(e,t,c,s,o):de(()=>{const n=E(!1);if(!n)throw new Error('no recaptcha');le(e,t,n,s,o)}),o.promise}function ce(e,t){const o=new n.Deferred;u(e).reCAPTCHAState={initialized:o};const s=ue(e),c=E(!0);return c?le(e,t,c,s,o):fe(()=>{const n=E(!0);if(!n)throw new Error('no recaptcha');le(e,t,n,s,o)}),o.promise}function le(e,t,n,o,s){n.ready(()=>{pe(e,t,n,o),s.resolve(n)})}function ue(e){const t=`fire_app_check_${e.name}`,n=document.createElement('div');return n.id=t,n.style.display='none',document.body.appendChild(n),t}async function he(e){y(e);const t=u(e).reCAPTCHAState,n=await t.initialized.promise;return new Promise((t,o)=>{const s=u(e).reCAPTCHAState;n.ready(()=>{t(n.execute(s.widgetId,{action:'fire_app_check'}))})})}function pe(e,t,n,o){const s=n.render(o,{sitekey:t,size:'invisible',callback:()=>{u(e).reCAPTCHAState.succeeded=!0},'error-callback':()=>{u(e).reCAPTCHAState.succeeded=!1}}),c=u(e);c.reCAPTCHAState=Object.assign(Object.assign({},c.reCAPTCHAState),{widgetId:s})}function de(e){const t=document.createElement('script');t.src="https://www.google.com/recaptcha/api.js",t.onload=e,document.head.appendChild(t)}function fe(e){const t=document.createElement('script');t.src="https://www.google.com/recaptcha/enterprise.js",t.onload=e,document.head.appendChild(t)}
/**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */class ge{constructor(e){this._siteKey=e,this._throttleData=null}async getToken(){var e,t,n;me(this._throttleData);const o=await he(this._app).catch(e=>{throw T.create("recaptcha-error")});if(!(null===(e=u(this._app).reCAPTCHAState)||void 0===e?void 0:e.succeeded))throw T.create("recaptcha-error");let s;try{s=await A(C(this._app,o),this._heartbeatServiceProvider)}catch(e){throw(null===(t=e.code)||void 0===t?void 0:t.includes("fetch-status-error"))?(this._throttleData=ve(Number(null===(n=e.customData)||void 0===n?void 0:n.httpStatus),this._throttleData),T.create("throttled",{time:_(this._throttleData.allowRequestsAfter-Date.now()),httpStatus:this._throttleData.httpStatus})):e}return this._throttleData=null,s}initialize(t){this._app=t,this._heartbeatServiceProvider=(0,e._getProvider)(t,'heartbeat'),se(t,this._siteKey).catch(()=>{})}isEqual(e){return e instanceof ge&&this._siteKey===e._siteKey}}class ke{constructor(e){this._siteKey=e,this._throttleData=null}async getToken(){var e,t,n;me(this._throttleData);const o=await he(this._app).catch(e=>{throw T.create("recaptcha-error")});if(!(null===(e=u(this._app).reCAPTCHAState)||void 0===e?void 0:e.succeeded))throw T.create("recaptcha-error");let s;try{s=await A(I(this._app,o),this._heartbeatServiceProvider)}catch(e){throw(null===(t=e.code)||void 0===t?void 0:t.includes("fetch-status-error"))?(this._throttleData=ve(Number(null===(n=e.customData)||void 0===n?void 0:n.httpStatus),this._throttleData),T.create("throttled",{time:_(this._throttleData.allowRequestsAfter-Date.now()),httpStatus:this._throttleData.httpStatus})):e}return this._throttleData=null,s}initialize(t){this._app=t,this._heartbeatServiceProvider=(0,e._getProvider)(t,'heartbeat'),ce(t,this._siteKey).catch(()=>{})}isEqual(e){return e instanceof ke&&this._siteKey===e._siteKey}}class we{constructor(e){this._customProviderOptions=e}async getToken(){const e=await this._customProviderOptions.getToken(),t=(0,n.issuedAtTime)(e.token),o=null!==t&&t<Date.now()&&t>0?1e3*t:Date.now();return Object.assign(Object.assign({},e),{issuedAtTimeMillis:o})}initialize(e){this._app=e}isEqual(e){return e instanceof we&&this._customProviderOptions.getToken.toString()===e._customProviderOptions.getToken.toString()}}function ve(e,t){if(404===e||403===e)return{backoffCount:1,allowRequestsAfter:Date.now()+864e5,httpStatus:e};{const o=t?t.backoffCount:0,s=(0,n.calculateBackoffMillis)(o,1e3,2);return{backoffCount:o+1,allowRequestsAfter:Date.now()+s,httpStatus:e}}}function me(e){if(e&&Date.now()-e.allowRequestsAfter<=0)throw T.create("throttled",{time:_(e.allowRequestsAfter-Date.now()),httpStatus:e.httpStatus})}
/**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   */function be(t=(0,e.getApp)(),o){t=(0,n.getModularInstance)(t);const s=(0,e._getProvider)(t,'app-check');if(p().initialized||X(),q()&&U().then(e=>console.log(`App Check debug token: ${e}. You will need to add it to your app's App Check settings in the Firebase console for it to work.`)),s.isInitialized()){const e=s.getImmediate(),n=s.getOptions();if(n.isTokenAutoRefreshEnabled===o.isTokenAutoRefreshEnabled&&n.provider.isEqual(o.provider))return e;throw T.create("already-initialized",{appName:t.name})}const c=s.initialize({options:o});return Te(t,o.provider,o.isTokenAutoRefreshEnabled),u(t).isTokenAutoRefreshEnabled&&Y(c,"INTERNAL",()=>{}),c}function Te(e,t,n){const o=h(e,Object.assign({},c));o.activated=!0,o.provider=t,o.cachedTokenPromise=F(e).then(t=>(t&&re(t)&&(o.token=t,te(e,{token:t.token})),t)),o.isTokenAutoRefreshEnabled=void 0===n?e.automaticDataCollectionEnabled:n,o.provider.initialize(e)}function Ee(e,t){const n=u(e.app);n.tokenRefresher&&(!0===t?n.tokenRefresher.start():n.tokenRefresher.stop()),n.isTokenAutoRefreshEnabled=t}async function ye(e,t){const n=await V(e,t);if(n.error)throw n.error;return{token:n.token}}function _e(e){return J(e)}function Pe(e,t,n,o){let s=()=>{},c=()=>{};return s=null!=t.next?t.next.bind(t):t,null!=t.error?c=t.error.bind(t):n&&(c=n),Y(e,"EXTERNAL",s,c),()=>Q(e.app,s)}const Ae='app-check-internal';(0,e._registerComponent)(new t.Component("app-check",e=>ie(e.getProvider('app').getImmediate(),e.getProvider('heartbeat')),"PUBLIC").setInstantiationMode("EXPLICIT").setInstanceCreatedCallback((e,t,n)=>{e.getProvider(Ae).initialize()})),(0,e._registerComponent)(new t.Component(Ae,e=>ae(e.getProvider('app-check').getImmediate()),"PUBLIC").setInstantiationMode("EXPLICIT")),(0,e.registerVersion)("@firebase/app-check","0.8.8")},1734,[865,866,867,868]);