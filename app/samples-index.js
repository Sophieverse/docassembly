/**
 * @module samples-index
 * Sample templates bundled with the app. The samples agent owns ../samples/index.js
 * (export const samples = [{id, name, description, text}]). We tolerate an empty array;
 * if the module is missing entirely main.js catches the import failure and uses [].
 */
import { samples as raw } from '../samples/index.js';

export const samples = Array.isArray(raw) ? raw.filter((s) => s && typeof s.text === 'string') : [];
