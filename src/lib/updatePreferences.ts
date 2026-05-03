const DISMISSED_VERSION_KEY = "openscreen_dismissed_update_version";
const CHECKS_DISABLED_KEY = "openscreen_update_checks_disabled";

export function getDismissedUpdateVersion(): string | null {
	try {
		return localStorage.getItem(DISMISSED_VERSION_KEY);
	} catch {
		return null;
	}
}

export function saveDismissedUpdateVersion(version: string): void {
	try {
		localStorage.setItem(DISMISSED_VERSION_KEY, version);
	} catch {
		// localStorage may be unavailable (e.g. private browsing quota exceeded)
	}
}

export function getUpdateChecksDisabled(): boolean {
	try {
		return localStorage.getItem(CHECKS_DISABLED_KEY) === "true";
	} catch {
		return false;
	}
}

export function setUpdateChecksDisabled(disabled: boolean): void {
	try {
		localStorage.setItem(CHECKS_DISABLED_KEY, disabled ? "true" : "false");
	} catch {
		// localStorage may be unavailable
	}
}
