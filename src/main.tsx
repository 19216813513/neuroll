import { render } from "preact";
import { App } from "./app/App";
import "./styles/base.css";

const root = document.getElementById("app");
if (!root) throw new Error("#app not found");

render(<App />, root);
