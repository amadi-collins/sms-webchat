import { useState } from "react";

const BRAND = "#5f1519";
const BRAND_DARK = "#4a0f13";
const BRAND_LIGHT = "#f9f0f0";
const BRAND_BORDER = "#d4a0a3";

const styles = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#f5f5f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    padding: "24px 16px",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: "12px",
    boxShadow: "0 4px 24px rgba(95,21,25,0.10)",
    width: "100%",
    maxWidth: "480px",
    overflow: "hidden",
  },
  header: {
    backgroundColor: BRAND,
    padding: "28px 32px 24px",
    color: "#fff",
  },
  headerTitle: {
    margin: 0,
    fontSize: "22px",
    fontWeight: 700,
    letterSpacing: "-0.3px",
  },
  headerSub: {
    margin: "6px 0 0",
    fontSize: "14px",
    opacity: 0.85,
  },
  body: {
    padding: "28px 32px 32px",
  },
  row: {
    display: "flex",
    gap: "14px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    marginBottom: "18px",
    flex: 1,
  },
  label: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#333",
    marginBottom: "6px",
  },
  required: {
    color: BRAND,
    marginLeft: "2px",
  },
  input: {
    padding: "10px 13px",
    borderRadius: "7px",
    border: `1.5px solid #ddd`,
    fontSize: "15px",
    outline: "none",
    transition: "border-color 0.2s",
    backgroundColor: "#fff",
  },
  inputFocus: {
    borderColor: BRAND,
    boxShadow: `0 0 0 3px rgba(95,21,25,0.08)`,
  },
  inputError: {
    borderColor: "#e53e3e",
  },
  errorText: {
    fontSize: "12px",
    color: "#e53e3e",
    marginTop: "4px",
  },
  consentBox: {
    backgroundColor: BRAND_LIGHT,
    border: `1.5px solid ${BRAND_BORDER}`,
    borderRadius: "8px",
    padding: "14px 16px",
    marginBottom: "20px",
  },
  consentText: {
    fontSize: "13px",
    color: "#555",
    lineHeight: 1.6,
    margin: 0,
  },
  checkRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    marginTop: "12px",
  },
  checkbox: {
    accentColor: BRAND,
    width: "17px",
    height: "17px",
    marginTop: "2px",
    cursor: "pointer",
    flexShrink: 0,
  },
  checkLabel: {
    fontSize: "13px",
    color: "#333",
    cursor: "pointer",
    lineHeight: 1.5,
  },
  button: {
    width: "100%",
    padding: "13px",
    backgroundColor: BRAND,
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "16px",
    fontWeight: 600,
    cursor: "pointer",
    transition: "background-color 0.2s",
    letterSpacing: "0.2px",
  },
  buttonHover: {
    backgroundColor: BRAND_DARK,
  },
  buttonDisabled: {
    backgroundColor: "#ccc",
    cursor: "not-allowed",
  },
  successCard: {
    textAlign: "center",
    padding: "48px 32px",
  },
  successIcon: {
    width: "60px",
    height: "60px",
    backgroundColor: BRAND_LIGHT,
    border: `2px solid ${BRAND_BORDER}`,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 20px",
    fontSize: "26px",
  },
  successTitle: {
    fontSize: "20px",
    fontWeight: 700,
    color: BRAND,
    margin: "0 0 8px",
  },
  successSub: {
    fontSize: "14px",
    color: "#666",
    margin: 0,
    lineHeight: 1.6,
  },
  divider: {
    height: "1px",
    backgroundColor: "#eee",
    margin: "0 0 20px",
  },
};

function Input({ label, required, error, ...props }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={styles.field}>
      <label style={styles.label}>
        {label}
        {required && <span style={styles.required}>*</span>}
      </label>
      <input
        {...props}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...styles.input,
          ...(focused ? styles.inputFocus : {}),
          ...(error ? styles.inputError : {}),
        }}
      />
      {error && <span style={styles.errorText}>{error}</span>}
    </div>
  );
}

export default function ConsentForm() {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    agreed: false,
  });
  const [errors, setErrors] = useState({});
  const [hovering, setHovering] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [serverError, setServerError] = useState("");

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  function validate() {
    const errs = {};
    if (!form.firstName.trim()) errs.firstName = "First name is required";
    if (!form.lastName.trim()) errs.lastName = "Last name is required";
    if (!form.phone.trim()) {
      errs.phone = "Phone number is required";
    } else if (!/^\+?[\d\s\-().]{7,}$/.test(form.phone)) {
      errs.phone = "Enter a valid phone number";
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errs.email = "Enter a valid email address";
    }
    if (!form.agreed) errs.agreed = "You must agree to continue";
    return errs;
  }

  async function handleSubmit() {
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setStatus("loading");
    setServerError("");

    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || undefined,
      consentText: "I agree to receive SMS communications.",
      consentTimestamp: new Date().toISOString(),
    };

    try {
      const res = await fetch("/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setServerError(err.message);
    }
  }

  if (status === "success") {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.header}>
            <h1 style={styles.headerTitle}>SMS Communications</h1>
          </div>
          <div style={styles.successCard}>
            <div style={styles.successIcon}>✓</div>
            <h2 style={styles.successTitle}>You're all set, {form.firstName}!</h2>
            <p style={styles.successSub}>
              Thanks for signing up. You'll receive a welcome text shortly.
              Reply to that message anytime you need support.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.headerTitle}>SMS Communications</h1>
          <p style={styles.headerSub}>Sign up to receive support via text message</p>
        </div>

        <div style={styles.body}>
          <div style={styles.row}>
            <Input
              label="First Name"
              required
              placeholder="Jane"
              value={form.firstName}
              onChange={set("firstName")}
              error={errors.firstName}
            />
            <Input
              label="Last Name"
              required
              placeholder="Smith"
              value={form.lastName}
              onChange={set("lastName")}
              error={errors.lastName}
            />
          </div>

          <Input
            label="Phone Number"
            required
            placeholder="+1 (555) 000-1234"
            type="tel"
            value={form.phone}
            onChange={set("phone")}
            error={errors.phone}
          />

          <Input
            label="Email Address"
            placeholder="jane@example.com"
            type="email"
            value={form.email}
            onChange={set("email")}
            error={errors.email}
          />

          <div style={styles.divider} />

          <div style={styles.consentBox}>
            <p style={styles.consentText}>
              By checking the box below, you agree to receive SMS text messages
              from us for support and updates. Message and data rates may apply.
              You can reply STOP at any time to opt out.
            </p>
            <div style={styles.checkRow}>
              <input
                type="checkbox"
                id="consent"
                style={styles.checkbox}
                checked={form.agreed}
                onChange={set("agreed")}
              />
              <label htmlFor="consent" style={styles.checkLabel}>
                I agree to receive SMS communications.
              </label>
            </div>
            {errors.agreed && <p style={{ ...styles.errorText, marginTop: "8px" }}>{errors.agreed}</p>}
          </div>

          {status === "error" && (
            <p style={{ ...styles.errorText, marginBottom: "14px", fontSize: "14px" }}>
              ⚠️ {serverError}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={status === "loading"}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            style={{
              ...styles.button,
              ...(hovering && status !== "loading" ? styles.buttonHover : {}),
              ...(status === "loading" ? styles.buttonDisabled : {}),
            }}
          >
            {status === "loading" ? "Submitting…" : "Sign Up for SMS Updates"}
          </button>
        </div>
      </div>
    </div>
  );
}