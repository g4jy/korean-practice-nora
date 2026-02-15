"""
Generate Korean TTS audio files for Sentence Builder app using edge-tts.
Voice: ko-KR-SunHiNeural
Reads data/vocab.json + data/sentences.json, generates MP3 + manifest.json in audio/tts/
"""

import asyncio
import edge_tts
import json
import os
import sys
import time
import hashlib

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VOCAB_PATH = os.path.join(BASE_DIR, 'data', 'vocab.json')
SENTENCES_PATH = os.path.join(BASE_DIR, 'data', 'sentences.json')
AUDIO_DIR = os.path.join(BASE_DIR, 'audio', 'tts')
VOICE = 'ko-KR-SunHiNeural'

generated_count = 0
total_count = 0


def extract_all_texts(data):
    """Extract all unique Korean text from vocab.json."""
    texts = set()

    # Action data
    action = data.get('action', {})
    for s in action.get('subjects', []):
        texts.add(s['kr'])
    for t in action.get('times', []):
        texts.add(t['kr'])
    for p in action.get('places', []):
        texts.add(p['kr'])
        if 'formE' in p: texts.add(p['formE']['kr'])
        if 'formEseo' in p: texts.add(p['formEseo']['kr'])
    for o in action.get('objects', []):
        texts.add(o['kr'])
    for v in action.get('verbs', []):
        for tense in ['past', 'present', 'future']:
            if tense in v: texts.add(v[tense])

    # Describe data
    desc = data.get('describe', {})
    for s in desc.get('subjects', []):
        texts.add(s['kr'])
    for a in desc.get('adjectives', []):
        texts.add(a['kr'])
    for adv in desc.get('adverbs', []):
        texts.add(adv['kr'])

    # Flashcard extra vocabulary
    fc = data.get('flashcards', {})
    for cat in fc.get('categories', []):
        for card in cat.get('cards', []):
            texts.add(card['kr'])

    # Intro data (for Clayton-style repos)
    intro = data.get('intro', {})
    for t in intro.get('topics', []):
        texts.add(t['kr'])
    for n in intro.get('nouns', []):
        texts.add(n['kr'])

    return sorted(texts)


def extract_sentence_texts():
    """Extract all unique Korean sentences from sentences.json."""
    texts = set()
    if not os.path.exists(SENTENCES_PATH):
        return texts
    with open(SENTENCES_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    for ch in data.get('chapters', []):
        for s in ch.get('sentences', []):
            if s.get('kr'):
                texts.add(s['kr'])
    return texts


def text_to_filename(text, index):
    h = hashlib.md5(text.encode('utf-8')).hexdigest()[:6]
    return f'{index:04d}_{h}.mp3'


async def generate(text, filepath, sem):
    global generated_count
    async with sem:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        tts = edge_tts.Communicate(text=text, voice=VOICE)
        await tts.save(filepath)
        generated_count += 1
        print(f'  [{generated_count}/{total_count}] {os.path.basename(filepath)} -> "{text}"')


async def main():
    global total_count, generated_count
    start = time.time()

    all_texts = set()

    # Extract from vocab.json
    if os.path.exists(VOCAB_PATH):
        with open(VOCAB_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        all_texts.update(extract_all_texts(data))

    # Extract from sentences.json
    all_texts.update(extract_sentence_texts())

    texts = sorted(all_texts)
    total_count = len(texts)
    print(f'Generating {total_count} TTS files...')
    print(f'Voice: {VOICE}')

    manifest = {}
    sem = asyncio.Semaphore(5)
    tasks = []

    for i, text in enumerate(texts):
        fname = text_to_filename(text, i)
        fpath = os.path.join(AUDIO_DIR, fname)
        manifest[text] = fname
        tasks.append(generate(text, fpath, sem))

    await asyncio.gather(*tasks)

    # Write manifest
    mpath = os.path.join(AUDIO_DIR, 'manifest.json')
    os.makedirs(AUDIO_DIR, exist_ok=True)
    with open(mpath, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    elapsed = time.time() - start
    total_size = sum(
        os.path.getsize(os.path.join(AUDIO_DIR, f))
        for f in os.listdir(AUDIO_DIR) if f.endswith('.mp3')
    )
    print(f'\nDone! {total_count} files, {total_size/1024:.1f} KB, {elapsed:.1f}s')


if __name__ == '__main__':
    asyncio.run(main())
