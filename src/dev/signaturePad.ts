// Dev-only entry: the signature pad and library on their own, in the app's window, until
// placing signatures on a page is built. See docs/signatures-backend.md.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "../app.css";
import { mount } from "svelte";
import SignaturePadDemo from "./SignaturePadDemo.svelte";

export default mount(SignaturePadDemo, { target: document.getElementById("app")! });
