/**
 * Date / time formatting utilities for chat messages.
 *
 * Pure functions only — no React, no DOM, no module-level state. The optional `now` parameter
 * makes them deterministic and testable. Localized strings go through @wordpress/i18n so callers
 * never need to format their own.
 */

import { __, sprintf, _n } from "@wordpress/i18n";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Coerce a timestamp (string | number | Date) into a valid Date or null.
 *
 * @param {string|number|Date|null|undefined} timestamp - Source value.
 * @return {Date|null} Valid Date instance, or null when missing/invalid.
 */
export const parseTimestamp = (timestamp) => {
	if (timestamp === null || timestamp === undefined || timestamp === "") {
		return null;
	}
	const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
	return Number.isNaN(date.getTime()) ? null : date;
};

const startOfDay = (date) => {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
};

/**
 * Short relative-time string for hover tooltips on individual messages.
 * Examples: "Just now", "5m ago", "2h ago", "3d ago", "Apr 28", "Apr 28, 2025".
 *
 * @param {string|number|Date} timestamp - The message timestamp.
 * @param {Date}               [now]     - Reference point; defaults to now. Override for tests.
 * @return {string} Localized label, or '' when timestamp is invalid.
 */
export const formatRelativeTime = (timestamp, now = new Date()) => {
	const date = parseTimestamp(timestamp);
	if (!date) {
		return "";
	}

	const diffMs = now.getTime() - date.getTime();
	if (diffMs < MINUTE) {
		return __("Just now", "wp-module-ai-chat");
	}
	if (diffMs < HOUR) {
		const minutes = Math.floor(diffMs / MINUTE);
		return sprintf(
			/* translators: %d: number of minutes */
			_n("%dm ago", "%dm ago", minutes, "wp-module-ai-chat"),
			minutes
		);
	}
	if (diffMs < DAY) {
		const hours = Math.floor(diffMs / HOUR);
		return sprintf(
			/* translators: %d: number of hours */
			_n("%dh ago", "%dh ago", hours, "wp-module-ai-chat"),
			hours
		);
	}
	if (diffMs < WEEK) {
		const days = Math.floor(diffMs / DAY);
		return sprintf(
			/* translators: %d: number of days */
			_n("%dd ago", "%dd ago", days, "wp-module-ai-chat"),
			days
		);
	}

	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
	});
};

/**
 * Group label for stacked-by-date message lists ("Today", "Yesterday", "Monday", "Apr 28").
 *
 * @param {string|number|Date} timestamp - The message timestamp.
 * @param {Date}               [now]     - Reference point; defaults to now.
 * @return {string} Localized group label, or '' when timestamp is invalid.
 */
export const formatDateGroup = (timestamp, now = new Date()) => {
	const date = parseTimestamp(timestamp);
	if (!date) {
		return "";
	}

	const today = startOfDay(now);
	const dateDay = startOfDay(date);
	const diffDays = Math.round((today.getTime() - dateDay.getTime()) / DAY);

	if (diffDays === 0) {
		return __("Today", "wp-module-ai-chat");
	}
	if (diffDays === 1) {
		return __("Yesterday", "wp-module-ai-chat");
	}
	if (diffDays > 1 && diffDays < 7) {
		return date.toLocaleDateString(undefined, { weekday: "long" });
	}
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
	});
};

/**
 * Group consecutive messages that share a date label. Each group also exposes its starting
 * index in the original messages array, so callers can keep stable keys / global indexing
 * without a second pass.
 *
 * Messages without a parseable timestamp join the most recent group (or get an empty label).
 *
 * @param {Array} messages - Array of message objects, each optionally with `timestamp`.
 * @param {Date}  [now]    - Reference point; defaults to now.
 * @return {Array<{label: string, messages: Array, startIndex: number}>}
 */
export const groupMessagesByDate = (messages, now = new Date()) => {
	if (!Array.isArray(messages) || messages.length === 0) {
		return [];
	}

	const groups = [];
	let runningIndex = 0;

	for (const message of messages) {
		const label = formatDateGroup(message?.timestamp, now);
		const lastGroup = groups[groups.length - 1];

		if (lastGroup && lastGroup.label === label) {
			lastGroup.messages.push(message);
		} else {
			groups.push({ label, messages: [message], startIndex: runningIndex });
		}
		runningIndex += 1;
	}

	return groups;
};
