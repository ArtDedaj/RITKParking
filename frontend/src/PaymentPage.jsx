import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export default function PaymentPage() {
  const { recurringId } = useParams();
  const [error, setError] = useState(null);
  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!recurringId) return;

    async function run() {
      try {
        const res = await fetch("/api/reservations/create-recurring-payment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ recurringId: Number(recurringId) }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error || "Payment request failed");
        }

        const data = await res.json();

        if (!data?.url) {
          throw new Error("No payment URL returned from server");
        }

        window.location.href = data.url;
      } catch (err) {
        console.error("Payment error:", err.message);
        setError(err.message);
      }
    }

    run();
  }, [recurringId]);

  if (error) {
    return (
      <div>
        <h2>Payment initialization failed</h2>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Try again</button>
      </div>
    );
  }

  return (
    <div>
      <h2>Generating parking permit invoice...</h2>
      <p>Redirecting to secure payment gateway...</p>
    </div>
  );
}