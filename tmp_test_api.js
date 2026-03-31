
const fetchAgents = async () => {
    try {
        const res = await fetch("http://localhost:3001/api/agents");
        const data = await res.json();
        const scout = data.agents.find(a => a.name.toLowerCase().includes("scout"));
        console.log("Scout ID:", scout.id);
        
        // Try Direct messaging
        const msgRes = await fetch(`http://localhost:3001/api/agents/${scout.id}/message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: "Analyze this repo: https://github.com/elizaos/eliza",
                userId: "user",
                userName: "User"
            })
        });
        console.log("Direct Msg Status:", msgRes.status);
        const msgText = await msgRes.text();
        console.log("Direct Msg Response:", msgText.substring(0, 100));
        
        // Try Session messaging (the way api-client does it)
        const sessionRes = await fetch("http://localhost:3001/api/messaging/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId: scout.id })
        });
        console.log("Session Create Status:", sessionRes.status);
        if (sessionRes.status === 201 || sessionRes.status === 200) {
            const sessionData = await sessionRes.json();
            const sessionId = sessionData.id || sessionData.session.id;
            console.log("Session ID:", sessionId);
            const sessMsgRes = await fetch(`http://localhost:3001/api/messaging/sessions/${sessionId}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: "Test Audit" })
            });
            console.log("Session Msg Status:", sessMsgRes.status);
        }

    } catch (e) {
        console.error("Test failed:", e);
    }
};
fetchAgents();
