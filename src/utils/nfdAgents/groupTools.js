/**
 * Group consecutive tools of the same name into a single entry so the UI can
 * render "Generating Images (3/6)" instead of six identical rows.
 *
 * Consecutive-only is intentional: an interleaved sequence like [A, B, A] stays
 * as three rows, which matches the order the assistant actually ran them in.
 *
 * Each group carries:
 * - total:       number of tools in the group
 * - completed:   how many finished successfully or with error
 * - activeCount: how many are currently running (active is a single tool, but
 *                modeled as a count to keep the shape uniform)
 * - hasError:    any completed member errored
 *
 * @param {Object}  input
 * @param {Array}   input.executed - Tools that have finished.
 * @param {?Object} input.active   - The currently-running tool, or null.
 * @param {Array}   input.pending  - Tools queued to run.
 * @return {Array} Grouped entries in original order.
 */
export const groupConsecutiveTools = ({ executed = [], active = null, pending = [] } = {}) => {
	const items = [];
	executed.forEach((tool) => items.push({ tool, status: "completed" }));
	if (active) {
		items.push({ tool: active, status: "active" });
	}
	pending.forEach((tool) => items.push({ tool, status: "pending" }));

	const groups = [];
	for (const { tool, status } of items) {
		const last = groups[groups.length - 1];
		if (last && last.name === tool.name) {
			last.total++;
			if (status === "completed") {
				last.completed++;
				if (tool.isError) {
					last.hasError = true;
				}
			} else if (status === "active") {
				last.activeCount++;
			}
		} else {
			groups.push({
				...tool,
				total: 1,
				completed: status === "completed" ? 1 : 0,
				activeCount: status === "active" ? 1 : 0,
				hasError: status === "completed" && !!tool.isError,
			});
		}
	}
	return groups;
};
