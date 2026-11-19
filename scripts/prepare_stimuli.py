"""Read the supplied workbook; keep every derived PEDFE asset local and ignored."""
import collections, csv, hashlib, itertools, json, pathlib, random, subprocess
import concurrent.futures
import openpyxl

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path('/Users/artem/Desktop/PEDFE_set_clips')
TABLE = pathlib.Path('/Users/artem/Desktop/Supplemental_Material_T5.xlsx')
OUT = ROOT / 'private'
OUT.mkdir(exist_ok=True)
(OUT / 'media').mkdir(exist_ok=True)
SEED = 20261119
rng = random.Random(SEED)
ws = openpyxl.load_workbook(TABLE, data_only=True).active
rows = []
for n, r in enumerate(ws.values, 1):
    if not isinstance(r[0], (int, float)) or not r[2]:
        continue
    rows.append(dict(subject=int(r[0]), gender=r[1], code=r[2], type=str(r[3]).lower(),
                     emotion=r[4], emotion_hit=r[5], type_hit=r[6], intensity=r[7], source_row=n))
codes = [r['code'] for r in rows]
assert len(codes) == len(set(codes)), 'Duplicate metadata codes'
files = {p.stem: p for p in SOURCE.glob('*.avi')}
missing = sorted(set(codes)-files.keys())
extra = sorted(files.keys()-set(codes))
available = [r for r in rows if r['code'] in files]
emotions = sorted({r['emotion'] for r in rows})
assert len(emotions) == 6

# Actor-matched genuine/posed pairs; two women and two men per emotion.
# Fix the set once for both power groups. Never select using authenticity hit rate.
used = set()
main = []
for emotion in sorted(emotions, key=lambda e: len({r['subject'] for r in available if r['emotion']==e and r['type']=='genuine'})):
    for gender in ['F', 'M']:
        actors = sorted({r['subject'] for r in available if r['emotion']==emotion and r['gender']==gender})
        pairs = {}
        for actor in actors:
            g = [r for r in available if r['subject']==actor and r['emotion']==emotion and r['type']=='genuine']
            p = [r for r in available if r['subject']==actor and r['emotion']==emotion and r['type']=='posed']
            if g and p:
                pairs[actor] = (g, p)
        fresh = [a for a in pairs if a not in used]
        pool = fresh if len(fresh)>=2 else list(pairs)
        assert len(pool)>=2, (emotion, gender)
        for actor in rng.sample(pool, 2):
            g,p = pairs[actor]
            # Small within-pair intensity difference, random seeded tie breaking.
            candidates = list(itertools.product(g,p))
            rng.shuffle(candidates)
            a,b = min(candidates, key=lambda ab: abs(ab[0]['intensity']-ab[1]['intensity']))
            main.extend([dict(a),dict(b)])
            used.add(actor)
assert len(main)==48
assert all(v==4 for v in collections.Counter((r['emotion'],r['type']) for r in main).values())
assert all(v==2 for v in collections.Counter((r['emotion'],r['type'],r['gender']) for r in main).values())
main_codes={r['code'] for r in main}
practice=[]
for typ in ['genuine','posed']:
    for gender in ['F','M']:
        pool=[r for r in available if r['type']==typ and r['gender']==gender and r['code'] not in main_codes and r['subject'] not in used]
        assert pool, (typ,gender)
        practice.append(dict(rng.choice(pool)))
assert not main_codes.intersection(r['code'] for r in practice)

def convert(item):
    item=dict(item)
    src=files[item['code']]
    dest=OUT/'media'/(item['code']+'.mp4')
    if not dest.exists():
        subprocess.run(['ffmpeg','-v','error','-y','-i',str(src),'-map','0:v:0','-an','-c:v','libx264','-crf','18','-preset','fast','-pix_fmt','yuv420p','-fps_mode','passthrough','-movflags','+faststart',str(dest)],check=True)
    def probe(path):
        return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','stream=codec_type,nb_frames,width,height,r_frame_rate,duration','-show_entries','format=duration','-of','json',str(path)]))
    source_info=probe(src); web_info=probe(dest)
    a=next(x for x in source_info['streams'] if x['codec_type']=='video')
    b=next(x for x in web_info['streams'] if x['codec_type']=='video')
    assert a['nb_frames']==b['nb_frames'], (src,a,b)
    item.update(id=hashlib.sha256(item['code'].encode()).hexdigest()[:16], filename=src.name,
                web_filename=dest.name, source_sha256=hashlib.sha256(src.read_bytes()).hexdigest(),
                web_sha256=hashlib.sha256(dest.read_bytes()).hexdigest(),
                duration_ms=round(float(web_info['format']['duration'])*1000,3), frames=int(b['nb_frames']),
                width=b['width'],height=b['height'], audio=False)
    return item

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    converted=list(executor.map(convert,main+practice))
manifest=dict(version='pedfe-pilot-2026-11-19-v1',seed=SEED,source=str(SOURCE),table=str(TABLE),
              main=converted[:48],practice=converted[48:])
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
with (OUT/'selected_stimuli.csv').open('w') as f:
    writer=csv.DictWriter(f,fieldnames=['phase']+list(converted[0].keys()));writer.writeheader()
    for phase,items in [('main',converted[:48]),('practice',converted[48:])]:
        writer.writerows(dict(phase=phase,**r) for r in items)
audit=dict(metadata_rows=len(rows),local_videos=len(files),missing=missing,unmatched_files=extra,
           cells={f'{e}/{t}':n for (e,t),n in collections.Counter((r['emotion'],r['type']) for r in main).items()},
           actors=len(used),training=len(practice),total_duration_seconds=sum(r['duration_ms'] for r in converted[:48])/1000,
           web_bytes=sum(p.stat().st_size for p in (OUT/'media').glob('*.mp4')),
           selection='Seeded actor-matched pairs, 2F/2M per cell; minimal intensity difference within each actor pair; no authenticity hit-rate threshold; no view annotation available in T5.',
           table_sha256=hashlib.sha256(TABLE.read_bytes()).hexdigest())
(OUT/'audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2))
print(json.dumps(audit,ensure_ascii=False,indent=2))
