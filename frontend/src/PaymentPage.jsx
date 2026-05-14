import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import api from "./api";

export default function PaymentPage({ recurringId: recurringIdProp }) {
  const { recurringId: recurringIdParam } = useParams();
  const recurringId = recurringIdProp ?? recurringIdParam;
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!recurringId) return;

    async function run() {
      try {
        // IMPORTANT: use cancel OR approval flow, not a fake endpoint
        const res = await api.cancelReservation(recurringId);

        if (res.checkoutSession?.url) {
          window.location.href = res.checkoutSession.url;
          return;
        }

        throw new Error("No payment session returned");
      } catch (err) {
        console.error(err);
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
      <h2>Redirecting to payment...</h2>
    </div>
  );
}