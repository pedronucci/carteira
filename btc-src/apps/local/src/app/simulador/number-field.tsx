import { useEffect, useRef, useState } from "react";

interface Props {
    label: string;
    value: number;
    onChange: (value: number) => void;
}

const display = (value: number) => Number.isFinite(value) ? String(value).replace(".", ",") : "";

/** Keep the typed text separate from the number used by the calculator. */
export function NumberField({ label, value, onChange }: Props) {
    const [draft, setDraft] = useState(() => display(value));
    const editing = useRef(false);

    useEffect(() => {
        if (!editing.current) setDraft(display(value));
    }, [value]);

    return <label className="block text-[12px] text-muted">
        {label}
        <input
            aria-label={label}
            aria-invalid={!Number.isFinite(value)}
            className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 text-[14px] text-ink"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={draft}
            onFocus={() => { editing.current = true; }}
            onChange={event => {
                const text = event.target.value;
                setDraft(text);
                // Empty/incomplete values invalidate the calculation instead of becoming zero.
                onChange(text.trim() === "" ? NaN : Number(text.replace(",", ".")));
            }}
            onBlur={() => {
                editing.current = false;
                if (Number.isFinite(value)) setDraft(display(value));
            }}
        />
    </label>;
}
