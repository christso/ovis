import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import { ChevronDown } from "lucide-react";

import type { AgentKind, SavedAgentLauncher } from "../../shared/protocol.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import { useT } from "../lib/i18n.ts";
import { useMachineApi } from "../lib/machineContext.tsx";
import { useAnnouncedText } from "../lib/useAnnouncedText.ts";
import { userErrorMessage } from "../lib/userError.ts";
import "./AgentLaunchPicker.css";

interface Props {
  agent: AgentKind | undefined;
  launcher: string;
  disabled: boolean;
  onLauncherChange: (id: string) => void;
  onLaunchersChange: (launchers: SavedAgentLauncher[], selected: string) => void;
  onEditingChange: (editing: boolean) => void;
}

export function AgentLaunchPicker({ agent, launcher, disabled, onLauncherChange, onLaunchersChange, onEditingChange }: Props) {
  const t = useT();
  const id = useId();
  const { fetchSavedLaunchers, saveAgentLauncher, deleteAgentLauncher, searchLauncherExecutables } = useMachineApi();
  const [editor, setEditor] = useState<{ id?: string; label: string; executable: string; args: string[] } | null>(null);
  const [open, setOpen] = useState<"launcher" | "executable" | null>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const searchRoot = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const launcherField = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const nameField = useRef<HTMLInputElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const returnToLauncher = useRef(false);
  const selected = agent?.launchers?.find((choice) => choice.id === launcher);
  const query = editor?.executable ?? "";
  const searchMessage = open === "executable" && query.trim() ? t(searchState === "loading" ? "Searching executables…" : searchState === "error" ? "Could not search this PC. Enter an executable or try again." : searchState === "ready" && !suggestions.length ? "No matching executables. You can enter a command or full path." : "Choose an executable or keep typing, then save the launcher.") : null;
  const announcedSearch = useAnnouncedText(searchMessage);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => { onEditingChange(editor !== null || busy); }, [editor, busy, onEditingChange]);
  useLayoutEffect(() => { if (editor) nameField.current?.focus({ preventScroll: true }); }, [editor?.id, editor !== null]);
  useLayoutEffect(() => {
    if (returnToLauncher.current && !editor && !busy) {
      returnToLauncher.current = false;
      launcherField.current?.focus({ preventScroll: true });
    }
  }, [editor, busy]);

  useEffect(() => {
    setSuggestions([]);
    if (open !== "executable" || !agent?.launcher_search || !query.trim()) { setSearchState("idle"); return; }
    const abort = new AbortController();
    let current = true;
    setSearchState("loading");
    const timer = setTimeout(() => {
      void searchLauncherExecutables(query.trim(), abort.signal).then((names) => {
        if (current) { setSuggestions(names); setSearchState("ready"); }
      }, () => { if (current) setSearchState("error"); });
    }, 180);
    return () => { current = false; clearTimeout(timer); abort.abort(); };
  }, [query, open, agent?.launcher_search, searchLauncherExecutables]);

  useLayoutEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const measure = (): void => {
      const anchor = open === "launcher" ? launcherField.current : searchField.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const below = Math.max(0, bottom - rect.bottom - 16);
      const above = Math.max(0, rect.top - top - 16);
      const up = below < 160 && above > below;
      setPlace({ left: rect.left, width: rect.width, maxHeight: Math.min(280, up ? above : below), ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
    };
    const scroll = (event: Event): void => {
      const anchor = open === "launcher" ? launcherField.current : searchField.current;
      if (anchor && event.target instanceof Node && event.target.contains(anchor)) measure();
    };
    measure();
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    return () => { document.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", measure); viewport?.removeEventListener("resize", measure); viewport?.removeEventListener("scroll", measure); };
  }, [open, query, searchState]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent): void => { if (!searchRoot.current?.contains(event.target as Node)) setOpen(null); };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); };
  }, [open]);

  const label = (choice: NonNullable<AgentKind["launchers"]>[number]): string => choice.label + (agent?.launchers?.some((other) => other.id !== choice.id && other.label === choice.label) ? ` · ${choice.id.slice(-8)}` : "");
  const optionGroups = [
    { key: "default", label: null, options: [{ key: "default", text: t("Default"), selected: !launcher, disabled: agent?.installed === false, choose: () => { if (launcher) onLauncherChange(""); } }] },
    { key: "saved", label: t("Saved launchers"), options: (agent?.launchers ?? []).map((choice) => ({ key: choice.id, text: label(choice), selected: launcher === choice.id, disabled: false, choose: () => { if (launcher !== choice.id) onLauncherChange(choice.id); } })) },
  ];
  const options = optionGroups.flatMap((group) => group.options);
  const choices = open === "executable" ? suggestions.map((name) => ({ key: name })) : options;
  // Keep identity when a delayed search response replaces the suggestion list.
  const highlighted = choices.find((choice) => choice.key === highlightedKey) ?? choices[0];
  const highlight = highlighted ? choices.indexOf(highlighted) : -1;
  const closePopup = (): void => { setOpen(null); setSuggestions([]); };
  usePhoneSheetBack(closePopup, open !== null);
  const choose = (index: number): void => {
    if (open === "executable") {
      const executable = suggestions[index];
      if (!editor || !executable) return;
      setEditor({ ...editor, executable });
      closePopup();
      searchField.current?.focus({ preventScroll: true });
    } else {
      const option = options[index];
      if (!option || option.disabled) return;
      option.choose(); closePopup(); setConfirmDelete(false); setError(null);
      launcherField.current?.focus({ preventScroll: true });
    }
  };
  useEffect(() => {
    setHighlightedKey(open === "launcher" ? options.find((option) => option.selected)?.key ?? null : null);
  }, [open, query]);
  useEffect(() => {
    if (!open) return;
    const option = document.getElementById?.(`${id}-choice-${highlight}`), menu = option?.closest<HTMLElement>(".launcher-choices");
    if (!option || !menu) return;
    const row = option.getBoundingClientRect(), bounds = menu.getBoundingClientRect();
    if (row.top < bounds.top) menu.scrollTop -= bounds.top - row.top;
    else if (row.bottom > bounds.bottom) menu.scrollTop += row.bottom - bounds.bottom;
  }, [highlight, open, suggestions]);

  const closeEditor = (): void => {
    setEditor(null);
    closePopup();
    setConfirmDelete(false);
    setError(null);
    returnToLauncher.current = true;
  };
  const cancelDelete = (): void => {
    setConfirmDelete(false);
    deleteButton.current?.focus({ preventScroll: true });
  };
  const edit = async (): Promise<void> => {
    closePopup();
    returnToLauncher.current = true;
    setBusy(true);
    setError(null);
    setConfirmDelete(false);
    try {
      const definitions = await fetchSavedLaunchers();
      if (!active.current) return;
      const found = definitions.find((entry) => entry.id === launcher && entry.kind === agent?.kind);
      if (!found) {
        onLaunchersChange(definitions, "");
        setError(t("This launcher was removed. Choose another launcher or add it again."));
      } else setEditor(found);
    } catch (reason) { if (active.current) setError(userErrorMessage(reason).detail ?? userErrorMessage(reason).message); }
    finally { if (active.current) setBusy(false); }
  };
  const save = async (): Promise<void> => {
    if (!agent || !editor || busy || disabled || !editor.label.trim() || !editor.executable.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const definitions = await saveAgentLauncher({ kind: agent.kind, label: editor.label, executable: editor.executable, args: editor.args }, editor.id);
      if (!active.current) return;
      onLaunchersChange(definitions, editor.id ?? definitions.at(-1)!.id);
      closeEditor();
    } catch (reason) { if (active.current) setError(userErrorMessage(reason).detail ?? userErrorMessage(reason).message); }
    finally { if (active.current) setBusy(false); }
  };
  const remove = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (!editor?.id) return;
      const definitions = await deleteAgentLauncher(editor.id);
      if (!active.current) return;
      onLaunchersChange(definitions, "");
      closeEditor();
    } catch (reason) { if (active.current) setError(userErrorMessage(reason).detail ?? userErrorMessage(reason).message); }
    finally { if (active.current) setBusy(false); }
  };
  return <>
    <span className="visually-hidden launcher-search-announcement" role="status">{announcedSearch}</span>
    {agent?.saved_launchers && <div ref={searchRoot} className="field" onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
      if (event.key !== "Escape" || (!open && !editor)) return;
      event.preventDefault(); event.stopPropagation();
      if (open) {
        const anchor = open === "launcher" ? launcherField.current : searchField.current;
        closePopup(); anchor?.focus({ preventScroll: true });
      } else if (confirmDelete) cancelDelete();
      else if (!busy) closeEditor();
    }}>
      <label className="field-label" htmlFor={`${id}-launcher`}>{t("Launcher")}</label>
      <div className="launcher-combobox" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(null); }}>
        <button ref={launcherField} type="button" id={`${id}-launcher`} className="input launcher-selector" role="combobox" aria-expanded={open === "launcher"} aria-controls={`${id}-choices`} aria-activedescendant={open === "launcher" && highlighted ? `${id}-choice-${highlight}` : undefined}
          disabled={disabled || busy || editor !== null} onClick={() => setOpen(open === "launcher" ? null : "launcher")}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); if (open === "launcher") choose(highlight); else setOpen("launcher"); }
            else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); event.stopPropagation();
              if (open !== "launcher") setOpen("launcher");
              else setHighlightedKey(options[Math.max(0, Math.min(options.length - 1, highlight + (event.key === "ArrowDown" ? 1 : -1)))]?.key ?? null);
            }
          }}><span>{selected ? label(selected) : t("Default")}</span><ChevronDown aria-hidden="true" /></button>
        {open === "launcher" && <div className="launcher-popup" style={place}>
          <div id={`${id}-choices`} className="launcher-choices" role="listbox" aria-label={t("Launcher")}>
            {optionGroups.filter((group) => group.options.length).map((group) => <div key={group.key} role={group.label ? "group" : "presentation"} aria-label={group.label ?? undefined}>
              {group.label && <div className="field-label launcher-choice-heading" aria-hidden="true">{group.label}</div>}
              {group.options.map((option) => {
                const index = options.indexOf(option);
                return <button type="button" tabIndex={-1} key={option.key} id={`${id}-choice-${index}`} role="option" aria-selected={option.selected} aria-disabled={option.disabled} className={index === highlight ? "launcher-choice active" : "launcher-choice"}
                  onPointerDown={(event) => event.preventDefault()} onPointerMove={() => setHighlightedKey(option.key)} onClick={() => choose(index)}>{option.text}</button>;
              })}
            </div>)}
          </div>
          <div className="launcher-footer">
            <button type="button" className="launcher-choice" onClick={() => { closePopup(); setConfirmDelete(false); setError(null); setEditor({ label: "", executable: "", args: [] }); }}>{t("Add launcher…")}</button>
            {selected && <button type="button" className="launcher-choice" onClick={() => void edit()}>{t("Edit launcher…")}</button>}
          </div>
        </div>}
      </div>
      {agent?.installed === false && !launcher && <span className="field-hint">{t("Choose a launcher to start {agent} on this PC.", { agent: agent.label })}</span>}
      {agent?.saved_launchers && <>
        {editor && <fieldset className="launcher-editor" onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); void save(); }
        }}>
          <legend className="field-label">{t(editor.id ? "Edit launcher" : "Add launcher")}</legend>
          <p className="field-hint">{t("Saved on this PC for future launches. Existing panes keep running.")}</p>
          <label className="field-label" htmlFor={`${id}-name`}>{t("Launcher name")}</label>
          <input ref={nameField} id={`${id}-name`} className="input" disabled={disabled || busy} value={editor.label} onChange={(event) => setEditor({ ...editor, label: event.target.value })} />
          <label className="field-label" htmlFor={`${id}-executable`}>{t("Executable")}</label>
          <div className="launcher-combobox" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(null); }}>
            <input ref={searchField} id={`${id}-executable`} className="input" disabled={disabled || busy} value={editor.executable} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
              role={agent.launcher_search ? "combobox" : undefined} aria-autocomplete={agent.launcher_search ? "list" : undefined} aria-expanded={agent.launcher_search ? open === "executable" : undefined} aria-controls={agent.launcher_search ? `${id}-executables` : undefined} aria-activedescendant={open === "executable" && highlighted ? `${id}-choice-${highlight}` : undefined}
              onFocus={() => { if (agent.launcher_search) setOpen("executable"); }} onClick={() => { if (agent.launcher_search) setOpen("executable"); }}
              onChange={(event) => { setEditor({ ...editor, executable: event.target.value }); setSuggestions([]); if (agent.launcher_search) setOpen("executable"); }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
                if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (open === "executable") choose(highlight); }
                else if (agent.launcher_search && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                  event.preventDefault(); event.stopPropagation(); setOpen("executable");
                  setHighlightedKey(suggestions[Math.max(0, Math.min(suggestions.length - 1, highlight + (event.key === "ArrowDown" ? 1 : -1)))] ?? null);
                }
              }} />
            {open === "executable" && query.trim() && <div className="launcher-popup" style={place}>
              <div id={`${id}-executables`} className="launcher-choices" role="listbox" aria-label={t("Executable")}>
                {suggestions.map((name, index) => <button type="button" tabIndex={-1} key={name} id={`${id}-choice-${index}`} role="option" aria-selected={index === highlight} className={index === highlight ? "launcher-choice active" : "launcher-choice"}
                  onPointerDown={(event) => event.preventDefault()} onPointerMove={() => setHighlightedKey(name)} onClick={() => choose(index)}>{name}</button>)}
              </div>
              {searchMessage && <span className="field-hint launcher-search-status" aria-hidden="true">{searchMessage}</span>}
            </div>}
          </div>
          <p className="field-hint">{t("Executable name on PATH or an absolute path on this PC. Saving does not install or run it.")}</p>
          {editor.args.map((arg, index) => <div className="field" key={index}>
            <label className="field-label" htmlFor={`${id}-arg-${index}`}>{t("Argument {number}", { number: index + 1 })}</label>
            <div className="launcher-argument">
              <input id={`${id}-arg-${index}`} className="input" disabled={disabled || busy} value={arg} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(event) => setEditor({ ...editor, args: editor.args.map((word, at) => at === index ? event.target.value : word) })} />
              <button type="button" className="btn btn-ghost" disabled={disabled || busy} aria-label={t("Remove argument {number}", { number: index + 1 })} onClick={() => { setEditor({ ...editor, args: editor.args.filter((_, at) => at !== index) }); nameField.current?.focus({ preventScroll: true }); }}>{t("Remove")}</button>
            </div>
          </div>)}
          <p className="field-hint">{t("Each argument is one value. Spaces stay inside it; shell syntax is not expanded.")}</p>
          {["codex", "omp"].includes(agent.kind) && <p className="field-hint">{t("For Codex or Oh My Pi profiles, add --profile and the profile ID as separate arguments.")}</p>}
          {editor.id && <div className="launcher-actions">
            <button ref={deleteButton} type="button" className={confirmDelete ? "btn btn-danger" : "btn btn-ghost"} disabled={disabled || busy} onClick={() => { closePopup(); if (confirmDelete) void remove(); else setConfirmDelete(true); }}>{t(confirmDelete ? "Delete launcher?" : "Delete")}</button>
            {confirmDelete && <button type="button" className="btn btn-ghost" disabled={disabled || busy} onClick={cancelDelete}>{t("Cancel")}</button>}
          </div>}
          <div className="launcher-actions">
            <button type="button" className="btn btn-ghost" disabled={disabled || busy} onClick={() => setEditor({ ...editor, args: [...editor.args, ""] })}>{t("Add argument")}</button>
            <button type="button" className="btn btn-ghost" disabled={disabled || busy} onClick={closeEditor}>{t("Cancel launcher")}</button>
            <button type="button" className="btn btn-primary" disabled={disabled || busy || !editor.label.trim() || !editor.executable.trim()} onClick={() => void save()}>{t("Save launcher")}</button>
          </div>
        </fieldset>}
        {busy && <span className="field-hint" role="status">{t("Updating launchers…")}</span>}
        {error && <p className="launcher-error" role="alert">{error}</p>}
      </>}
    </div>}
  </>;
}
