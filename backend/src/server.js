const app = require("./app");
const expireSeatLocks = require("./utils/expireSeatLocks");
require("dotenv").config();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`EventX server running on http://localhost:${PORT}`);
});

setInterval(() => {
    expireSeatLocks();
}, 1000);