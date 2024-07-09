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

import {log, $, getErrorDescription, delay, debounce} from './utils.js';
import {getStyle} from './popup-style.js';

log.config({name: 'imo'});
//log.config({enabled: true, enableRouting: true});

/*
 * consts
 */

/** @type {string} */
const randKey = Math.trunc(Math.random() * 0x80000000).toString(16);
/** @type {string} */
const randId = `appsweets-imo-${randKey}`;
/** @type {Map} */
const lineToShortStateMap = new Map([
	['direct',          ''  ],
	['alnum',           'A_'],
	['alnum-wide',      'Ａ'],
	['hiragana',        'あ'],
	['katakana',        'ア'],
	['katakana-narrow', 'ｱ_']
]);
/** @type {Map} */
const stateToLineMap = new Map;

const speech = new class {
	#lineToAudioMap = new Map;
	#currentVoice;
	#getAudioFromLine (line) {
		if (this.#lineToAudioMap.has(line)) {
			return Promise.resolve(this.#lineToAudioMap.get(line));
		}
		else {
			return new Promise(resolve => {
				const audio = new Audio(chrome.runtime.getURL(`voice/${line}.mp3`));
				this.#lineToAudioMap.set(line, audio);
				audio.loop = false;
				audio.addEventListener('loadeddata', () => {
					resolve(audio);
				}, {once: true});
			});
		}
	}

	async play (line) {
		this.pause();
		try {
			const audio = await this.#getAudioFromLine(line);
			if (audio) {
				this.#currentVoice = audio;
				this.#currentVoice.currentTime = 0;
				this.#currentVoice.volume = settings.volume;
				await Promise.all([
					this.#currentVoice.play(),
					sendNotifyMessage({type: 'notifyPlayAudio'})
				]);
			}
		}
		catch (err) {
			log(`failed to play: ${getErrorDescription(err)}`);
		}
	}

	pause () {
		this.#lineToAudioMap.forEach(audio => {
			if (!audio.paused && !audio.ended) {
				audio.pause();
			}
		});
	}
};

const activeElementTracker = new class {
	#element;
	#aborter;
	#resizeObserver = new ResizeObserver(entries => {
		log(`active element resized`);
		this.#handleResize(entries);
	});
	#mutationObserver = new MutationObserver(mutationList => {
		let found = false;
		for (const mutation of mutationList) {
			if (mutation.type !== 'childList') continue;
			if ([...mutation.removedNodes].some(node => node === this.#element)) {
				found = true;
				break;
			}
		}
		if (found) {
			this.#unregister('mutation');
		}
	});
	#handleResize = debounce(entries => {
		log(`active element resized (debounced)`);
		for (const entry of entries) {
			if (entry.target === this.#element) {
				locatePopup(entry.target);
				break;
			}
		}
	}, 50);

	#unregister (from) {
		if (!this.#element) return;

		log(`activeElementTracker.unregister (${from})`);

		this.#aborter.abort();
		this.#resizeObserver.disconnect();
		this.#mutationObserver.disconnect();

		setTargetStyle(this.#element, false);
		closePopup();
		this.#element = undefined;
	}

	register (elm) {
		log(`activeElementTracker.register ${elm.outerHTML.match(/<[^>]+>/)[0]}`);

		this.#element = elm;
		this.#aborter = new AbortController;
		this.#resizeObserver.observe(elm);
		this.#mutationObserver.observe(elm.parentNode, {childList: true});

		elm.addEventListener('focusout', e => {
			this.#unregister(`focusout ${e.target.outerHTML.match(/<[^>]+>/)[0]}`);
		}, {once: true, signal: this.#aborter.signal});
	}

	get element () {
		return this.#element;
	}
};

/*
 * variables
 */

/** @type {object | undefined} */
let settings;
/** @type {object | undefined} */
let lastIMData;

/*
 * functions
 */

/**
 * @param {string} message
 */
function sendNotifyMessage (message) {
	chrome.runtime.sendMessage(message).catch(() => {})
}

/**
 * @param {string} line
 * @returns {string | null}
 */
function getShortStateFromLine (line) {
	return lineToShortStateMap.get(line) ?? null;
}

/**
 * @param {string} state
 * @returns {string | null}
 */
function getLineFromState (state) {
	if (stateToLineMap.has(state)) {
		return stateToLineMap.get(state);
	}
	else {
		for (const [line, states] of Object.entries(settings.lines)) {
			if (states.includes(state)) {
				stateToLineMap.set(state, line);
				return line;
			}
		}
		return null;
	}
}

/**
 * @param {HTMLElement} target
 * @returns {boolean}
 */
function isContentEditable (el) {
	if (!el) return false;

	/*
	 * special rules that apply only to this extension
	 */

	if (el.tagName === 'IFRAME') return true;

	/*
	 * orginal check part
	 */

	if (el.isContentEditable) return true;
	if (el.tagName === 'TEXTAREA') return !el.readOnly;
	if (el.tagName === 'INPUT') {
		if (el.readOnly) return false;
		return settings?.inputTypes.includes(el.type);
	}

	return false;
}

/**
 * @param {CSSStyleDeclaration} style
 * @returns {boolean}
 */
function isStyleUpdated (style) {
	return style.backgroundColor !== settings?.style.backgroundColor
		|| style.color !== settings?.style.color;
}

/**
 * @param {object} data
 * @returns {boolean}
 */
function isIMDataUpdated (data) {
	return data.enable !== lastIMData?.enable
		|| data.keyboard !== lastIMData?.keyboard
		|| data.longState !== lastIMData?.longState
		|| data.shortState !== lastIMData?.shortState;
}

/**
 * @param {HTMLElement} el
 * @returns {boolean}
 */
function isFixedPosition (el) {
	for (; el && el instanceof HTMLElement; el = el.parentNode) {
		if (window.getComputedStyle(el).position === 'fixed') {
			return true;
		}
	}

	return false;
}

function createStyle () {
	let el = $(`${randId}-style`);
	if (!el) {
		el = document.head.appendChild(document.createElement('style'));
		el.type = 'text/css';
		el.id = `${randId}-style`;
	}
	el.textContent = getStyle(randId, settings.style);
}

/**
 * @param {HTMLElement} target
 * @param {boolean} isActive
 */
function setTargetStyle (target, isActive) {
	if (isActive) {
		target.classList.add(randId);
	}
	else {
		target.classList.remove(randId);
		if (target.getAttribute('class') === '') {
			target.removeAttribute('class');
		}
	}
}

/**
 * @param {HTMLElement} target
 * @returns {DOMRect}
 */
function getBoundingClientRectEx (target) {
	try {
		if (target.shadowRoot) {
			return target.shadowRoot.activeElement.getBoundingClientRect();
		}
	}
	catch {
		;
	}
	return target.getBoundingClientRect();
}

/**
 * @param {HTMLElement} elm
 * @returns {HTMLElement}
 */
function getActiveElement (elm = document.activeElement) {
	while (elm?.shadowRoot?.activeElement) {
		elm = elm.shadowRoot.activeElement;
	}
	return elm;
}

/**
 * @param {HTMLElement} target
 * @param {object} popupContent
 * @param {boolean} isActive
 */
function showPopup (target, popupContent, isActive) {
	let el = $(`${randId}-pop`);

	if (!el) {
		el = document.body.appendChild(document.createElement('div'));
		el.className = `${randId}-pop`;
		el.id = `${randId}-pop`;

		const shadow = el.attachShadow({mode: 'open'});
		shadow.innerHTML = `\
<link rel="stylesheet" href="${chrome.runtime.getURL('lib/popup-style.css')}">
<div class="container"><span class="input-mode"></span><small class="keyboard-name"></small></div>
`;
	}

	const line = getLineFromState(popupContent.longState);
	const shortState = getShortStateFromLine(line);

	el.shadowRoot.querySelector('.input-mode').textContent =
		shortState ?? popupContent.shortState;
	el.shadowRoot.querySelector('.keyboard-name').textContent =
		popupContent.keyboard;

	if (isActive) {
		el.classList.remove('deactive');
		el.classList.add('active');
	}
	else {
		el.classList.remove('active');
		el.classList.add('deactive');
	}

	locatePopup(target);
}

function closePopup () {
	let el = $(`${randId}-pop`);
	el?.remove();
}

/**
 * @param {HTMLElement} target
 * @returns {Promise<undefined>}
 */
async function locatePopup (target) {
	const popup = $(`${randId}-pop`);
	if (!popup) return;

	// a little dirty hack...
	const codeMirrorContainer = target.closest('.CodeMirror');
	if (codeMirrorContainer) {
		target = codeMirrorContainer;
	}

	const popupStyle = window.getComputedStyle(popup);
	if (popupStyle.visibility !== 'visible'
	|| !/^\d+/.test(popupStyle.left)
	|| !/^\d+/.test(popupStyle.top)) {
		popup.style.position = 'absolute';
		popup.style.visibility = 'visible';
		popup.style.left = '-100%';
		popup.style.top = '0';
		await delay(1);
	}

	const LOOP_SENTINEL_COUNT = 10;
	const ARROW_MARGIN = 8;
	const rect = getBoundingClientRectEx(target);
	let lastLeft = rect.left + window.scrollX;
	let lastTop = rect.top + window.scrollY;

	for (let i = 0; i < LOOP_SENTINEL_COUNT; i++) {
		await delay(1000 * 0.1);

		const targetStyle = window.getComputedStyle(target);
		const rect = getBoundingClientRectEx(target);
		const targetLeft = rect.left + window.scrollX;
		const targetTop = rect.top + window.scrollY;

		let popupLeft = targetLeft +
			parseInt(targetStyle['border-left-width'], 10) +
			parseInt(targetStyle['padding-left'], 10);
		let popupRight;
		let popupTop = targetTop - popup.offsetHeight - ARROW_MARGIN;

		popup.classList.remove('up');
		popup.classList.remove('down');
		popup.classList.remove('left');
		popup.classList.remove('right');

		/*
		 * Generally, use "pop-up".
		 * If that's not possible, try "pop-left" and then "pop-down" in that order
		 * to see if they can be displayed.
		 */

		if (window.scrollY <= popupTop) {
			popup.classList.add('up');
		}
		else {
			if (popup.offsetWidth + ARROW_MARGIN < rect.left) {
				// pop-left: locate the popup next to the left of the target
				popup.classList.add('left');
				popupRight = targetLeft - popup.offsetWidth - ARROW_MARGIN;
				if (target.nodeName === 'INPUT') {
					popupTop = targetTop + (rect.height / 2) - (popup.offsetHeight / 2);
				}
				else {
					popupTop = targetTop +
						parseInt(targetStyle['border-top-width'], 10) +
						parseInt(targetStyle['padding-top'], 10);
				}
				popupLeft = undefined;
			}
			else {
				// pop-down: locate the popup below the target
				popup.classList.add('down');
				popupTop = targetTop + target.offsetHeight + ARROW_MARGIN;
			}
		}

		if (popupLeft !== undefined) {
			popupLeft = Math.max(
				window.scrollX, Math.min(
					popupLeft,
					window.scrollX + document.documentElement.clientWidth - popup.offsetWidth));
		}

		if (popupTop !== undefined) {
			popupTop = Math.max(
				window.scrollY, Math.min(
					popupTop,
					window.scrollY + document.documentElement.clientHeight - popup.offsetHeight));
		}

		if (isFixedPosition(target)) {
			popup.style.position = 'fixed';
			popup.style.left = `${(popupLeft ?? popupRight) - window.scrollX}px`;
			popup.style.top = `${popupTop - window.scrollY}px`;
		}
		else {
			popup.style.position = 'absolute';
			popup.style.left = `${popupLeft ?? popupRight}px`;
			popup.style.top = `${popupTop}px`;
		}

		if (targetLeft === lastLeft && targetTop === lastTop) {
			break;
		}

		lastLeft = targetLeft;
		lastTop = targetTop;
	}
}

/**
 * @param {Event} e
 */
const handleFocusInCore = debounce(e => {
	//log(`    handleFocusInCore, target: ${e?.target?.tagName ?? '(N/A)'}`);
	const target = e.target;
	if (!isContentEditable(target)) return;

	activeElementTracker.register(target);
	const isActive = settings.coloredStates.includes(lastIMData.longState);

	// target element styling
	if (settings.enable && settings.enableStyle) {
		setTargetStyle(target, isActive);
	}
	else {
		setTargetStyle(target, false);
	}

	// popup
	if (settings.enable && settings.enablePopup) {
		showPopup(target, lastIMData, isActive);
	}
	else {
		closePopup();
	}

	// speech
	if (settings.enable && settings.enableSpeech
	 && Date.now() - lastIMData.lastAudioPlayedTime >= settings.speechIntervalSecs * 1000) {
		const line = getLineFromState(lastIMData.longState);
		if (line) {
			speech.play(line);
		}
	}
}, 50);

/*
 * event handlers
 */

/**
 * @param {Event} e
 */
function handleFocusIn (e) {
	if (!e.target) return;
	if (!isContentEditable(e.target)) return;
	sendNotifyMessage({type: 'notifyFocusIn', name: e.target.tagName});
}

/**
 * @param {object} message
 * @returns {Promise<undefined>}
 */
async function handleMessage (message) {
	switch (message.type) {
	case 'invalidate-settings':
		//log(`got invalidate-settings message on ${location.href}`);
		settings = undefined;
		stateToLineMap.clear();
		break;

	default:
		{
			log(`*** handleMessage${message.data ? (': ' + message.data.shortState) : ''} ***`);
			if (message.settings) {
				const needCreateStyle = isStyleUpdated(message.settings.style);
				settings = message.settings;

				if (needCreateStyle) {
					createStyle();
				}
			}

			if (message.data) {
				const activeElement = getActiveElement();
				const needDispatchEvent = isIMDataUpdated(message.data);
				const needShowPopup = settings.enable && settings.enablePopup && !$(`${randId}-pop`);
				lastIMData = message.data;

				if (activeElement) {
					if (needDispatchEvent
					|| needShowPopup
					|| activeElement !== activeElementTracker.element) {
						handleFocusInCore({target: activeElement});
					}
				}
			}
		}
	}
}

export function run () {
	document.addEventListener('focusin', handleFocusIn, true);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	handleMessage(request)
		.catch(err => {
			log(`exception ${getErrorDescription(err)}`);
		})
		.finally(() => {
			sendResponse(true);
		});
	return true;
});

// vim:set ts=4 sw=4 fenc=UTF-8 ff=unix ft=javascript fdm=marker fmr=<<<,>>> :
