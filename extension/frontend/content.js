'use strict';

/*
 * Input Method Observer
 *
 * @author akahuku@gmail.com
 */
/**
 * Copyright 2024 akahuku, akahuku@gmail.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

Promise.all([
	import(chrome.runtime.getURL('lib/content.js')),
	new Promise(resolve => {
		if (/^(?:complete|interactive)$/.test(document.readyState)) {
			resolve();
		}
		else {
			document.addEventListener('DOMContentLoaded', resolve, {once: true});
		}
	})
]).then(p => {
	p[0].run();
});