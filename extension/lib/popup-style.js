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

export function getStyle (id, style) {
	return `\
.${id},
.${id}-pop, .${id}-pop-up, ${id}-pop-down,
.${id}-pop-active, .${id}-pop-deactive {
	--border-color:${style.borderColor ?? '#ccc'};

	--active-background-color:${style.backgroundColor};
	--active-color:${style.color};

	--deactive-background-color:#fff;
	--deactive-color:#222;
}

.${id} {
	/*background-color: var(--active-background-color) !important;*/
	background: linear-gradient(to right, var(--active-background-color), 90%, rgba(0,0,0,0)) !important;
	color: var(--active-color) !important;
	caret-color: var(--active-color) !important;
}

.${id}-pop {
	box-sizing:border-box;
	position:${style.position ?? 'absolute'};
	display:inline-block;
	margin:0;
	padding:4px 6px 4px 6px;
	border:1px solid var(--border-color);
	border-radius:4px;
	font-size:small;
	line-height:1;
	box-shadow:0px 0px 3px 0px rgba(0,0,0,.125);
	visibility:hidden;
	z-index:16777216;
	cursor:pointer;
}
.${id}-pop small {
	display:inline-block;
	margin:0 0 0 6px;
	padding:3px 6px 3px 6px;
	background-color:var(--active-color);
	color:var(--active-background-color);
	border-radius:4px;
	opacity:50%;
	vertical-align:baseline;
	font-size:90%;
}
.${id}-pop::before {
	content:"";
	position:absolute;
	left:50%;
	margin-left:-6px;
	border:6px solid transparent;
	z-index:2;
}
.${id}-pop::after {
	content:"";
	position:absolute;
	left:50%;
	margin-left:-6px;
	border:6px solid transparent;
	z-index:1;
}

.${id}-pop-up::before {
	top:calc(100% - 1px);
	border-top:6px solid black;
}
.${id}-pop-up::after {
	top:100%;
	border-top:6px solid var(--border-color);
}

.${id}-pop-down::before {
	top:-11px;
	border-bottom:6px solid black;
}
.${id}-pop-down::after {
	top:-12px;
	border-bottom:6px solid var(--border-color);
}

.${id}-pop-left::before {
	left:calc(100% + 5px);
	top:calc(50% - 6px);
	border-left:6px solid black;
}
.${id}-pop-left::after {
	left:calc(100% + 6px);
	top:calc(50% - 6px);
	border-left:6px solid var(--border-color);
}

.${id}-pop-right::before {
	left:-5px;
	top:calc(50% - 6px);
	border-right:6px solid black;
}
.${id}-pop-right::after {
	left:-6px;
	top:calc(50% - 6px);
	border-right:6px solid var(--border-color);
}

.${id}-pop-active {
	background-color:var(--active-background-color);
	color:var(--active-color);
}
.${id}-pop-active.${id}-pop-up::before {
	border-top-color:var(--active-background-color);
}
.${id}-pop-active.${id}-pop-down::before {
	border-bottom-color:var(--active-background-color);
}
.${id}-pop-active.${id}-pop-left::before {
	border-left-color:var(--active-background-color);
}
.${id}-pop-active.${id}-pop-right::before {
	border-right-color:var(--active-background-color);
}

.${id}-pop-deactive {
	background-color:var(--deactive-background-color);
	color:var(--deactive-color);
}
.${id}-pop-deactive.${id}-pop-up::before {
	border-top-color:var(--deactive-background-color);
}
.${id}-pop-deactive.${id}-pop-down::before {
	border-bottom-color:var(--deactive-background-color);
}
.${id}-pop-deactive.${id}-pop-left::before {
	border-left-color:var(--deactive-background-color);
}
.${id}-pop-deactive.${id}-pop-right::before {
	border-right-color:var(--deactive-background-color);
}
	`;
}
