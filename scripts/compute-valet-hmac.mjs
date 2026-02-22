import { createHmac } from 'crypto';
import fs from 'fs';

const receiptPath = 'tests/fixtures/valet-integration/receipt.json';
const hmacKey = 'valet-test-key';
const createdAt = '2026-02-22T00:00:00.000';

function asRecord(value) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	return value;
}

function asString(value) {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asMessageArray(value) {
	if (!Array.isArray(value)) return undefined;
	const items = value
		.map(entry => asRecord(entry))
		.filter(entry => Boolean(entry))
		.map(entry => {
			const role =
				asString(entry.role) || asString(entry.speaker) || asString(entry.author) || 'assistant';
			const content =
				asString(entry.content) || asString(entry.text) || asString(entry.message) || '';
			return { role, content };
		})
		.filter(entry => entry.content.length > 0);
	return items.length > 0 ? items : undefined;
}

function normalizeValetToTranscript(receipt) {
	const directMessages = asMessageArray(receipt.messages);
	const transcriptMessages = asMessageArray(asRecord(receipt.transcript)?.messages);
	const conversationMessages = asMessageArray(receipt.conversation);

	const prompt =
		asString(receipt.prompt) ||
		asString(receipt.input) ||
		asString(asRecord(receipt.request)?.prompt) ||
		asString(asRecord(receipt.request)?.input);

	const completion =
		asString(receipt.completion) ||
		asString(receipt.output) ||
		asString(asRecord(receipt.response)?.text) ||
		asString(asRecord(receipt.response)?.output_text) ||
		asString(asRecord(receipt.result)?.text);

	let messages = directMessages || transcriptMessages || conversationMessages;
	if (!messages || messages.length === 0) {
		const synthesized = [];
		if (prompt) synthesized.push({ role: 'user', content: prompt });
		if (completion) synthesized.push({ role: 'assistant', content: completion });
		messages = synthesized;
	}

	const transcript = {
		messages,
		model:
			asString(receipt.model) ||
			asString(asRecord(receipt.request)?.model) ||
			asString(asRecord(receipt.response)?.model) ||
			'unknown',
		created_at:
			asString(receipt.created_at) ||
			asString(receipt.timestamp) ||
			asString(asRecord(receipt.response)?.created_at) ||
			'unknown',
	};

	const inputs =
		asRecord(receipt.inputs) ||
		asRecord(receipt.request) ||
		asRecord(asRecord(receipt.transcript)?.inputs);
	if (inputs) {
		transcript.inputs = inputs;
	}

	return transcript;
}

function canonicalJson(value) {
	if (value === null) return 'null';
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map(item => canonicalJson(item)).join(',')}]`;
	}
	if (typeof value === 'object') {
		const record = value;
		const keys = Object.keys(record).sort();
		const entries = keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
		return `{${entries.join(',')}}`;
	}
	return JSON.stringify(String(value));
}

// Read and update receipt
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
receipt.created_at = createdAt;

// Compute canonical transcript
const transcript = normalizeValetToTranscript(receipt);
const canonicalTranscript = canonicalJson(transcript);

// Compute HMAC-SHA256
const hmac = createHmac('sha256', hmacKey);
hmac.update(canonicalTranscript);
const hmacHex = hmac.digest('hex');

console.log(hmacHex);
