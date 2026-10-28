const lockId = process.env.LOCK_ID;
const token = process.env.AUTH_TOKEN;

if (!token) {
    console.error("AUTH_TOKEN is missing");
    process.exit(1);
}

if (!lockId) {
    console.error("LOCK_ID is missing");
    process.exit(1);
}

async function confirmBooking(requestNumber) {
    try {
        const response = await fetch(
            "http://localhost:5000/api/bookings/confirm",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    lockId: lockId
                })
            }
        );

        const data = await response.json();

        return {
            request: requestNumber,
            status: response.status,
            data
        };

    } catch (error) {
        return {
            request: requestNumber,
            error: error.message
        };
    }
}

async function runTest() {

    console.log("Starting concurrent booking test...");
    console.log("Lock ID:", lockId);
    console.log();

    const results = await Promise.all([
        confirmBooking(1),
        confirmBooking(2)
    ]);

    console.log("RESULTS:");
    console.log(JSON.stringify(results, null, 2));
}

runTest();