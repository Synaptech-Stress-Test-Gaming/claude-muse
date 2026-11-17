# Research appendix (evidence behind the requests)

Gathered 2026-11-13 by 15 parallel research agents (Sonnet and Haiku). Tags:
- **[V]** = seen in a fetched page, abstract or search excerpt.
- **[M]** = agent memory or derivation, unverified.

Most items come from abstracts or excerpts, not full texts. Use the numbers as justified defaults, not as facts to cite.

---

## A. Muscle, eye and motion artifacts

**Muscle (EMG)**
- **Whitham et al. 2007**, Clin Neurophysiol 118:1877 [V]: under neuromuscular paralysis, scalp power above 20 Hz fell 10-200×, so most scalp EEG above 20 Hz is EMG. https://pubmed.ncbi.nlm.nih.gov/17574912
- **Whitham 2008**, "Thinking activates EMG" [V]: gamma is maximal near cranial and cervical muscles. https://dx.doi.org/10.1016/j.clinph.2008.01.024
- **Goncharova et al. 2003**, Clin Neurophysiol 114:1580 [V]: frontalis EMG peaks around 20-30 Hz frontally and temporalis around 40-80 Hz temporally. Even weak contraction mimics alpha, mu and beta over the whole scalp. https://www.neurotechcenter.org/sites/default/files/misc/EMG%20contamination%20of%20EEG%20spectral%20and%20topographical%20characteristics.pdf
- **Muthukumaraswamy 2013**, Front Hum Neurosci 7:138 [V]: EMG spans about 20-300 Hz, even "clean" resting EEG is contaminated, and frontal-temporal sites are worst. https://www.frontiersin.org/articles/10.3389/fnhum.2013.00138
- **Fitzgibbon 2013** [V]: a Laplacian reduces EMG at central sites, but needs many electrodes.
- **Conclusion:** no filter separates EMG from beta. Prefer theta, alpha and low beta (13-20 Hz), detect EMG and gate it. Don't regress muscle out using temporal channels: they contain brain signal too. TP9/TP10 as an EMG reference is not validated.

**Artifact subspace reconstruction (ASR)**
- **Basics** (Mullen 2015; Chang et al. 2020, IEEE TBME 67(4):1114) [V]: works on 500 ms chunks. Optimal cutoff k=20-30 in driving data. A walking study (n=5, PMC7560919) matched manual cleaning at k=7-14. https://pmc.ncbi.nlm.nih.gov/articles/PMC7560919
- **Low-density ASR** (IEEE Sensors J 2022) [V]: ASR still beats other multichannel methods down to 4 channels. https://airus.unisalento.it/retrieve/631e692c-03e5-46b4-af8c-b79bf96e0729/A_Method_for_Optimizing_the_Artifact_Subspace_Reconstruction_Performance_in_Low-Density_EEG.pdf
- **Muse 2 with meegkit ASR defaults** (chess study) [V]: feasible, weakly validated. https://arxiv.org/pdf/2505.07592
- **Limit** [M]: ASR handles large transients well and sustained moderate EMG only partly.
- **rASR** (Blum et al. 2019, Front Hum Neurosci 13:141) [V]: Riemannian ASR, 24 channels × 27 subjects, better on blinks and faster. https://www.frontiersin.org/articles/10.3389/fnhum.2019.00141 . MATLAB: https://github.com/s4rify/rASRMatlab (MIT).

**Other cleaning methods**
- **ORICA** (Hsu et al. 2016, IEEE TNSRE 24:309) [V]: online ICA, needs high density. ICA is not usable with 4 channels. https://pmc.ncbi.nlm.nih.gov/articles/PMC4824543
- **iCanClean** (Downey & Ferris 2023, Sensors 23:8214) [V]: phantom data quality went from 15.7% to 55.9%, vs ASR 27.6%, Auto-CCA 27.2%, adaptive filtering 32.9%. Best walking setting: 4 s window, r²=0.65. MATLAB only. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10574843/ . Ledwidge 2025 (running): somewhat better than ASR. https://pmc.ncbi.nlm.nih.gov/articles/PMC12349273
- **Accelerometer NLMS** (Rosanne et al. 2021, Front Neurosci 15:611962) [V]: n=48, 8 dry channels, 500 taps, chest accelerometer at 50 Hz using the L2 norm. Workload accuracy went from 89.2% to 95.0% at low activity and from 88.9% to 91.2% at high activity. Hyperparameters were tuned on all subjects, so the result may be inflated. https://pmc.ncbi.nlm.nih.gov/articles/PMC8058356
- **Kilicarslan & Contreras-Vidal**: 2016 H-infinity filter for ocular artifacts; 2019 motion removal using infrared tracking, not an accelerometer [V].
- **Wavelet denoising**: BrainFlow `perform_wavelet_denoising` (bior3.9, level 3) [V]. Good for spikes and blinks, not broadband EMG. https://brainflow.readthedocs.io/en/stable/notebooks/denoising.html
- **Deep denoisers** (1D-ResCNN, EEGDNet, IC-U-Net): not verifiable, offline, trained on semi-synthetic EEGdenoiseNet data. Unsuitable.
- **Aperiodic slope / specparam** [V]: the 30-45 Hz slope is biased by EMG, ECG and the reference, and fits fail often with eyes open (eNeuro 2022). https://www.eneuro.org/content/9/5/ENEURO.0094-22.2022

**Motion**
- Walking artifacts sit mostly below 10 Hz, at step harmonics, spanning about 0.1-20 Hz, and exceed EEG on dry systems [V].
- Head turns, talking and frowning produce EMG plus electrode shifts. An accelerometer reference does not fix EMG, so gating is unavoidable.
- Dry electrodes show large motion artifacts during walking and running (Luu et al. 2024, IEEE TIM, n=8) [M].

**Blinks** [M]: 100-200 µV, mostly below 4 Hz, frontal. Saccades are steps with opposite polarity between AF7 and AF8. With 4 channels, rejecting or holding for 0.5-1 s is safer than regression.

**Tools**
- No JavaScript ASR exists. Port from asrpy (https://github.com/DiGyt/asrpy, BSD-3 per PyPI; check the LICENSE file) or meegkit (https://github.com/nbara/python-meegkit).
- Timeflux has an rASR plugin (https://github.com/timeflux/timeflux_rasr).

## B. Focus, attention and workload

**Theta/beta ratio**
- Arns, Conners & Kraemer 2013 meta-analysis (9 studies, 1253 ADHD vs 517 controls) [V]: not reliable.
- Strzelczyk et al. 2026, eLife multiverse analysis [V]: reported TBR effects are driven by aperiodic activity and individual alpha frequency (IAF). https://elifesciences.org/articles/111114

**Indices with better support**
- **Pope, Bogart & Bartolome 1995**, Biol Psychol 40:187 [V]: β/(α+θ) was the best of 4 indices for flight-deck engagement. It is beta-heavy. https://ntrs.nasa.gov/citations/20050000198
- **Gevins 1997**, Cereb Cortex 7:374 (n=8, 115 ch) [V]: frontal midline theta rises with load (anterior cingulate), and slow parietocentral alpha falls. https://pubmed.ncbi.nlm.nih.gov/9177767/
- **Onton, Delorme & Makeig 2005**, NeuroImage 27:341 (71 ch, ICA) [V]: the theta source is near dorsal anterior cingulate; the effect comes from a fraction of trials with large variance. This is a source-level finding. https://sccn.ucsd.edu/papers/OntonTheta05.pdf
- **Workload meta-analysis** (Psychophysiology 2022) [V]: frontal theta is the most consistent workload index, with heterogeneity. https://hal-cea.archives-ouvertes.fr/ACHIL/hal-03556815v1
- **2025 review** [V]: the theta/alpha ratio tracks load, but is not reliable across task types. https://public-pages-files-2025.frontiersin.org/journals/neuroergonomics/articles/10.3389/fnrgo.2025.1621309/pdf

**Cross-session and cross-subject decoding**
- **Passive BCI competition**, Roy et al. 2022 (MATB-II, 15 subjects, 3 sessions) [V]: best entries Riemannian, cross-session accuracy under 60% vs 38% chance. https://www.frontiersin.org/articles/10.3389/fnrgo.2022.838342
- **Strict leave-one-subject-out benchmark** (N-back + MATB): 0.449 balanced accuracy [V].
- **Domain adaptation**: about +3-7% [V].

**Re-centering and alignment**
- Zanini 2018, TBME 65:1107 (re-centering) [V]: https://hal.archives-ouvertes.fr/hal-01923278
- He & Wu 2019 (Euclidean alignment) [V]: https://arxiv.org/abs/1808.05464
- Bleuzé 2022 (18 databases, 349 subjects; +2.7% vs RPA) [V]: https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2022.1049985/pdf

**Foundation models** (CBraMod ICLR 2025, LaBraM, EEGPT) [V]: pretrained on clinical wet caps, need labeled fine-tuning, no browser deployment. Not for the live score.

**OpenBCI hardware validity**
- Frey 2016 (arXiv 1606.02438) [V]: OpenBCI 16 ch at 125 Hz with **wet** electrodes. Workload AUROC 0.853 vs g.USBamp 0.860 (not significant). P300 0.918 vs 0.961 (p<0.01). https://arxiv.org/html/1606.02438
- No peer-reviewed validation of Ultracortex dry combs exists [V: absent].

**Consumer focus scores** (none published as validated)
- OpenBCI GUI focus widget [V, partial]: high alpha (7.5-12.5 Hz) with low beta reads as focused, a threshold rule. https://openbci.com/community/using-openbci-guis-focus-widget-to-harness-alpha-and-beta-waves/
- Neurosity: beta/theta over frontal channels [V, marketing].
- BrainFlow MLModel built-in models: trained on the developers' own data [V].

**Minimum baseline** [M]: 10 s is marginal. Alpha is usable at 20-30 s. Use median/MAD, not mean/SD.

## C. Stress (arousal)

**Heart rate and HRV windows**
- HR is the most consistent acute-stress marker. RMSSD and HF fall under stress (Castaldo 2015 meta-analysis: 12 studies, 758 people) [V]. https://wrap.warwick.ac.uk/69425/
- **Muñoz 2015**, PLoS ONE (n=3387, ECG) [V]: a 10 s RMSSD gives r≈0.85 vs 5 min, three 10 s windows r≈0.94, and 120 s r=0.986. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4586373/
- **Esco & Flatt 2014** [V]: 60 s ICC 0.98, 10 s ICC 0.81. https://www.jssm.org/jssm-13-535.xml-abst
- **Baek 2015** [V]: RMSSD needs at least 30 s, and HF is unreliable under 1 min. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5998753/
- **Castaldo 2019** (exam vs rest, n=42) [V]: HR-based features held down to 1 min. https://wrap.warwick.ac.uk/112982/
- **Shaffer & Ginsberg 2017** [M]: 5 min is the standard; ultra-short HRV is exploratory.

**Typical sizes** [M]: mental arithmetic or Stroop gives HR +3-10 bpm and RMSSD −10-30%. TSST gives HR +10-20 bpm and RMSSD −20-40%. The current +40 bpm and ×0.5 references are too extreme.

**Gaming**
- A VR, FIFA and iRacing study [V]: all raised HR and lowered RMSSD/HF. https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1380903/pdf
- Seated gaming is about +3-10 bpm; movement can add 10-30 bpm [M]. Gate on the accelerometer.

**EEG stress**
- Frontal alpha asymmetry is weak as a state marker (Smith 2017; van der Vinne 2017) [M].
- SAM40 (Ghosh 2022, 40 subjects, 32 ch Emotiv) [V]: claims of about 99% are inflated by within-subject splits; with subject-grouped splits, chance to about 85% (unreviewed preprint). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8749216/
- Models may learn eye and muscle signatures (Front Hum Neurosci 2025 ear-EEG) [V]. https://www.frontiersin.org/articles/10.3389/fnhum.2025.1685087
- WESAD with chest physiology reaches about 93% binary [M].

**Muse 2 PPG** (2026 preprint vs Polar H10, n=28 seated) [V]: HR ICC ≥0.999 with bias around 0. RMSSD ICC 0.60, bias +19 ms (about 1.9×), higher in at least 27 of 28 sessions. https://sciety.org/articles/activity/10.64898/2026.10.05.26364782

**PPG in general**
- Pulse-rate variability is not HRV: about 3-4 ms RMSSD difference, n=931 [V]. https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2025.1630032/text
- Errors are 14-51% higher during activity (Rehman 2024, n=25) [V].

**Commercial stress scores**
- Garmin/Firstbeat: fixed HRV bands 0-25/26-50/51-75/76-100, from inactive periods only [V].
- WHOOP: 14-day personal baseline [V].
- Oura: daily recalibrated personal baseline [V].
- Fitbit: baseline built over the first month [V].
- None publish validation.

## D. OpenBCI Cyton, Daisy and WiFi Shield

**Data format and scaling** (https://docs.openbci.com/Cyton/CytonDataFormat/ and https://docs.openbci.com/Cyton/CytonSDK/)
- 250 packets/s over the radio [V]. With Daisy, odd packets are channels 1-8 and even packets are 9-16. Each value is the average of the current and previous sample, and the first sample is invalid.
- 33-byte packet: `0xA0`, sample counter (wraps at 255), 8×24-bit signed MSB-first, 6 aux bytes, footer `0xC0-0xC6` (C0 = accelerometer, C1 = raw aux, C3/C4 and C5/C6 time-stamped after `<`) [V].
- Scale: 4.5 V / gain / (2^23−1). Gain codes 0..6 = 1, 2, 4, 6, 8, 12, 24 (default 24) [V].
- LIS3DH accelerometer: about 25 Hz interlaced with time-stamping [V]. Which packets carry it in Daisy mode: [M].
- Board modes [V]: `/0` default accelerometer, `/2` analog A5-A7 (replaces the accelerometer), `/3` digital, `/4` marker.

**Dongle**
- FTDI virtual COM port at 115200 baud [M].
- Latency timer must be set to 1 ms (Device Manager → Port Settings → Advanced) [V]. https://docs.openbci.com/Troubleshooting/FTDI_Fix_Windows/
- The `~` sample-rate command is useless over the dongle radio (over 250 Hz isn't carried) [V].

**Commands** [V]
- Channel settings: `x CH PWR GAIN INPUT BIAS SRB2 SRB1 X`. Channels are 1-8 and QWERTYUI for 9-16. Default `060110`. `d` resets to defaults; `D` queries them.
- Lead-off: `z CH P N Z` at 31.5 Hz.
- Streaming: `b`/`s` start/stop, `v` soft reset, `?` registers.
- Daisy: `C`/`c` attach/detach.
- The board times out multi-byte commands after 1 s.

**Impedance**
- Z = (RMS_µV·1e-6·√2)/6e-9 A [V, openbci-stream notebook]. https://openbci-stream.readthedocs.io/en/latest/notebooks/A2-electrodes_impedance.html
- The GUI's exact formula is undocumented (brainflow #765) [V].
- The GUI impedance widget has a bug at ≤500 kΩ [V].

**ECG and EEG on one board** (https://docs.openbci.com/GettingStarted/Biosensing-Setups/ExGSetup and https://docs.openbci.com/GettingStarted/Biosensing-Setups/ECGSetup/)
- EEG on the Cyton, ECG on a Daisy channel. SRB2 ON for EEG, OFF for ECG ("cardiac signals reference themselves"). Gel snap electrodes. BIAS goes to LL, the sternum or RL [V].
- Torso Mason-Likar placement avoids limb muscle artifact; shifts of up to 6 cm had no significant effect [V, preprint].

**HRV sampling rate**
- Task Force 1996: 250-500 Hz is optimal; at least 100 Hz works only with parabolic interpolation [V].
- Ellis 2015: with cubic-spline R-peak refinement, all 24 HRV measures held below 100 Hz [V]. https://smcnus.comp.nus.edu.sg/archive/pdf/2014-2016/2015_HRV.pdf
- Kwon 2018: 100 Hz is acceptable for time-domain HRV; 50 Hz fails for RMSSD [V]. https://pmc.ncbi.nlm.nih.gov/articles/PMC6085204
- Derivation [M]: at 125 Hz without interpolation, RMSSD² gains about 32 ms² (+4% at 20 ms, +15% at 10 ms). With interpolation the error is negligible.

**R-peak detection and quality**
- Elgendi 2013 two moving averages (about 97 ms and 611 ms) [V]. https://pmc.ncbi.nlm.nih.gov/articles/PMC3774726
- Pan-Tompkins was designed for 200 Hz; rescale the 5-15 Hz band, use an integrator of about 150 ms, a 200 ms refractory and a 360 ms T-wave check [V/M].
- NeuroKit2 detectors are available [V].
- Lipponen & Tarvainen 2019 beat correction (96.96% sensitivity, 99.94% specificity for ectopics; Python reference in `systole`) [V]. https://legrandnico.github.io/systole/notebooks/3-DetectingAndCorrectingArtefacts.html
- Kubios median-filter thresholds (medium 0.25 s) [V].
- Quality: Orphanidou 2015 template correlation; Zhao & Zhang 2018 kSQI (about 5 or more = clean) [V].

**Ultracortex Mark IV 16-ch** [V] (https://docs.openbci.com/AddOns/Headwear/MarkIV/)
- Cyton 1-8 = Fp1 Fp2 C3 C4 P7 P8 O1 O2. Daisy 9-16 = F7 F8 F3 F4 T7 T8 P3 P4 (the Daisy order is inferred).
- 14 spiky and 2 flat electrodes. SRB earclip with a Y-splitter; BIAS on the other ear.
- No dry-comb impedance figures are published.
- Gel-free cap target: under 20 kΩ.

**WiFi Shield**
- Deprecated: "no longer offered for sale due to reliability issues", packet loss and "cyclical noise spikes", "proceed at your own risk" [V]. https://docs.openbci.com/Deprecated/WiFiShield/WiFiLanding/ and https://docs.openbci.com/Deprecated/WiFiShield/WiFiGS/
- Daisy rates 250 to 8000 Hz; default 1000 Hz with 10 ms latency [V].
- Direct AP mode at 192.168.4.1, or station mode. No WPA2-Enterprise [V].
- Pushes TCP (raw or JSON); UDP and UDPx3 also offered [V].
- Losses of 50-60 packets about once a minute at 1000 Hz × 16 ch [V]. https://github.com/OpenBCI/OpenBCI_WIFI/issues/82
- Latest firmware v2.0.5 [V].
- BrainFlow `CYTON_DAISY_WIFI_BOARD` (id 6): `ip_port` required, `ip_address` optional (SSDP otherwise), `timeout` 10 s [V]. https://brainflow.readthedocs.io/en/stable/SupportedBoards.html
- Accelerometer channels over WiFi in BrainFlow: unverified.
- `~4` = 1000 Hz mapping for Daisy: unverified.

**Browser access**
- Web Serial is stable since Chrome 89. Using it with the dongle is plausible but untested.
- `@openbci/cyton` is Node-only and `openbci-utilities` is deprecated [V].
- A browser can't receive a TCP push, so a local helper is required [M].
- BrainFlow WASM is unconfirmed [V].

**Aliasing** [M, derivation]: at 125 Hz per channel, a residual 120 Hz harmonic folds to 5 Hz. The ADS1299 sinc filter and pair averaging attenuate it, but this must be verified.

## E. Drowsiness

- **Jap et al. 2009**, Expert Syst Appl 36:2352 (n=52) [V]: all ratios rise over a monotonous drive; (θ+α)/β rises most. https://opus.cloud1.lib.uts.edu.au/handle/10453/8938
- **Lal & Craig 2001** review [V]: delta and theta rise with fatigue. https://opus.lib.uts.edu.au/handle/10453/5537
- **Simulated-driving review** [V]: occipital alpha up (51.7% of studies), frontal theta up, inconsistent overall. https://pmc.ncbi.nlm.nih.gov/articles/PMC8198610
- **Simon 2011**, Clin Neurophysiol 122:1168 [V]: alpha spindles beat alpha band power in real traffic.
- **Schleicher 2008**, Ergonomics 51:982 [V]: blink duration, blink interval, lid-reopening delay and closure speed are the best sleepiness indicators. Large individual differences. https://www.ingentaconnect.com/content/10.1080/00140130701817062
- **Blink-duration thresholds** [V]: normal blinks are about 190-270 ms; a blink over 500 ms is a drowsy marker in a wearable study.
- **EEG/EOG fusion** beats PERCLOS alone [V]. https://pmc.ncbi.nlm.nih.gov/articles/PMC4786962
- **Muse drowsiness** review [V, not opened]: temporal features beat frontal; best case 98.8%. https://pmc.ncbi.nlm.nih.gov/articles/PMC9164820
- **Normalization**: deviation from an "alert model" (EURASIP 2008) [V]. https://asp-eurasipjournals.springeropen.com/track/pdf/10.1155/2008/519480 . Caveat: someone already drowsy at the start hides it.

## F. Blink and clench buttons

**Blinks**
- **Kaneko & Sakamoto 1999** [V]: spontaneous blinks have smaller EOG amplitude than voluntary ones; EOG duration did not differ significantly. https://journals.sagepub.com/doi/ref/10.2466/pms.1999.88.3.1037
- **Abe 2014** (camera) [V]: voluntary blinks about 421-480 ms vs involuntary about 297-352 ms.
- **Nakanishi 2014** EOG voluntary-blink switch [V]: 97.28% with template correlation. https://www.jstage.jst.go.jp/article/ieejeiss/134/7/134_897/_article/-char/en
- **EEG headsets** [V]: 85.9% vs 99.3% for infrared oculography; about 88% from Fp1 with adaptive thresholds. https://isip.piconepress.com/conferences/ieee_spmb/2022/papers/l01_03.pdf
- No double-blink false-positive rates for a consumer headset exist.

**Jaw clench**
- Masseter EMG near 50-60 Hz, frontalis 30-40 Hz, temporal 40-80 Hz [V].
- EarEOG [V]: 94.1% (97.3% personalized) for clench and eye gestures, under 125 ms delay. https://www.yorku.ca/mack/etra2025.html
- Muse built-in blink and jaw_clench flags (Mind Monitor OSC `/muse/elements/blink`, `/muse/elements/jaw_clench`): no published method or accuracy [V].
- NeuroSkill (third-party) [V]: jaw clench on TP9/TP10, blinks on AF8. https://cdn.jsdelivr.net/npm/neuroloop@0.1.2/METRICS.md

**Design** [M]
- **Blink detector:** derivative plus amplitude on a 1-10 Hz frontal signal, with a 150-250 ms refractory.
- **Double blink:** 150-500 ms gap.
- **Passive tuning:** from spontaneous blinks, about 7-10 per 30 s, using median + 3·MAD with a 1.5×-median floor.
- **Clench detector:** 25-55 Hz envelope at ≥3× baseline for 100-200 ms, bilateral.
- **Rejections:** reject a chew (more than 2 bursts in 1.5 s) or a burst shorter than 100 ms. A deliberate clench is a single burst of 0.2-0.6 s.

## G. Self-calibrating normalization

**Literature**
- **Shenoy 2006** [V]: nonstationarity is real, and simple adaptive methods help. https://pure.korea.ac.kr/en/publications/towards-adaptive-classification-for-bci/
- **Vidaurre 2011** [V]: unsupervised adaptation, good performance after 3-6 min with no offline calibration. Adapting bias/mean is safer than adapting the full classifier [M]. https://scienceportal.tecnalia.com/en/publications/toward-unsupervised-adaptation-of-lda-for-brain-computer-interfac/
- **Schirrmeister 2017** [V]: exponential moving standardization (decay 0.999). https://arxiv.org/pdf/1703.05051
- **Adaptive neurofeedback thresholds** (about 60-80% reward) [V]: useful for engagement, a poor state measure, and sometimes "little better than sham".
- **Nam & Choi 2020** [V]: easier initial thresholds work better. https://neuroregulation.org/article/view/20383
- **Fazli 2009** [V]: subject-independent BCI with moderate loss. https://proceedings.neurips.cc/paper/2009/hash/8a1e808b55fde9455cb3d8857ed88389-Abstract.html
- **Hierarchical Bayesian priors** (EUSIPCO 2022) [V]. https://eurasip.org/Proceedings/Eusipco/Eusipco2022/pdfs/0001308.pdf

**Absorption maths** [M, derivation]
- Cumulative mean with H minutes of history: a state held T minutes keeps H/(H+T) of its shift.
  - H=10, T=20: 33%
  - H=60: 75%
  - H=600: 97%
- Exponential moving average (τ): a state keeps exp(−T/τ).
  - τ=15 min, T=20 min: 26%
  - τ=30 min: 51%
  - τ=2 h: 85%
- Time for a step change to be 50% absorbed:
  - cumulative: equal to the history length
  - exponential: 0.69τ
  - windowed (length W): W/2

**Estimators** [lit/M]
- **Weighted Welford/West 1979 with w = dt:** W'=W+w; m'=m+(w/W')δ; S'=S+wδ(x−m'). The mean update equals the user's formula.
- **Use the hop length, not the window length**, so overlapping windows aren't counted several times.
- **Clean-time clock:** gaps don't age the estimate.
- **Effective sample size:** n_eff = T/(2τ_int), measured by batch means on 20 s blocks.
- **Normal-inverse-gamma prior:**
  - κn=κ0+W; μn=(κ0μ0+Wx̄)/κn; αn=α0+W/2; βn=β0+S/2+κ0W(x̄−μ0)²/(2κn)
  - Predictive distribution: Student-t.
  - With κ0=T0/τc, personal data gets 50% weight at T0 and 90% at 9·T0.

**Streaming quantiles**
- A log-space histogram (about 200 bins, about 2 KB, mergeable, decays by scaling) beats t-digest (old npm package) and P² (unweighted, can't merge or decay) for this use.

**Robustness**
- Winsorize at ±3-3.5 robust σ, or use Huber weights.
- Anti-stall: if values are clipped for more than 60 s, treat it as a change, not as noise.
- Cold start: use the prior's σ for the first 60 s.

**Change detection**
- CUSUM on 20 s block means (k=0.5, h=4-5).
- Bayesian online changepoint detection (Adams & MacKay 2007) is optional.
- On detection: shrink W ×0.1-0.2 (re-seat) or reset to the prior (new person).

**Proposed per-metric policy** [M]
- Focus: offset τ 60-90 min.
- Stress: offset τ 30-60 min, optional time-of-day bins (HRV is circadian [V]).
- Drowsiness: baseline frozen within the session, merged at session end.
- Offsets clamped to ±0.5σ.
- Down-weight the first 10 min of each contact epoch to 0.25×. Dry-electrode settling is only indirectly evidenced: sweat lowers impedance by up to 25% [V].

**Mapping** [M]
- Logistic of z with slope 1.7 (≈Φ): 50 = usual, 88 = +2σ.
- Avoid min-max.
- Percentiles need at least about 200 independent windows.

**Confidence badges** [M]
- 0-3 min: population norms
- 3-15 min: learning
- 15-60 min: personal, medium
- over 60 min: personal, high

**Offline test suite proposal** [M]: 14 tests.
1. Batch equality to 1e-9.
2. Gap invariance (exact).
3. Overlap invariance (<2% σ).
4. Step absorption (cumulative 45-55% at t=T).
5. Slow drift (<0.3σ error).
6. Artifact injection (<0.05σ shift, and a visible shift without winsorizing).
7. Stall rule (>50% adoption).
8. Prior blending (45-55% personal share at T0; >85% at 9·T0).
9. Changepoint false alarms (<1 per 10 h).
10. Changepoint detection within 3 min for a 1.5σ step.
11. Cross-session order stability (<3 points).
12. Serialization round-trip.
13. Score monotonicity with no NaN.
14. Histogram quantiles within one bin.

## H. Person identification

**EEG**
- Campisi & La Rocca 2014 review [V]. https://iris.uniroma3.it/handle/11590/139954
- Maiorana 2016 (50 subjects, 3 sessions over 6 weeks, "reasonably reliable") [V].
- CEREBRE (100% with ERPs to 500 images; not resting EEG) [V].
- **Large multi-session study** (345 subjects, 6007 sessions) [V]: EER 10.3% at 1 s and 3.0% averaging 4 samples. 6.7% after 1 day, 14.3% after 1 year. Hand-crafted PSD/AR features had 19-29% EER. Parietal-occipital channels were best. https://arxiv.org/html/2501.17866v3
  - Muse-channel subset: 18.2% / 13.1% EER. Cross-device: 12.5-44%.
- **MusicID** (Muse, 20 users) [V]: over 97%, but a small own-lab study. https://arxiv.org/pdf/2006.01751
- **Aperiodic features** beat canonical bands for fingerprinting (Demuru & Fraschini 2020) [V]. https://arxiv.org/pdf/2001.09424
- **Alpha-peak fingerprint stable over months** (MEG) [V]. https://pmc.ncbi.nlm.nih.gov/articles/PMC8481307

**ECG**
- **Melzi et al. benchmark** [V]: PTB multi-session 96.5% identification; 1-lead EER 5.1% multi-session. https://ar5iv.labs.arxiv.org/html/2204.03992
- **Non-fiducial autocorrelation + DCT** (Agrafioti & Hatzinakos) [V]: 96.2%. https://doi.org/10.1155%2F2008%2F148658

**PPG**: reviews flag session-leakage inflation; cross-session EER is about 20% [V]. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12736706/

**Expected accuracy here** [M]

| Setup | Closed-set ID | Open-set EER |
|---|---|---|
| Muse EEG only | about 60-80% | about 20-30% |
| Cyton EEG only | about 70-85% | about 15-25% |
| Cyton EEG + ECG | about 90-97% | about 4-8% |

**Design** [M]
- Buffer 45-60 s of clean data.
- Mahalanobis or diagonal-Gaussian likelihood summed across modalities, then a posterior over the profiles plus "new person".
- Accept at ≥0.8 posterior with a margin over the runner-up.
- No update before identity is confident; use the neutral prior while uncertain.
- One-tap correction relabels the session from stored per-session summaries.
- Templates stay local only.

## I. Public datasets (optional offline tests)

- **COG-BCI** (Hinss 2023, Sci Data, DOI 10.1038/s41597-022-01898-y): 29 participants, 3 sessions, MATB, N-back, PVT and Flanker, with ECG. https://zenodo.org/records/7413650
- **STEW** (14 ch Emotiv, 128 Hz, 48 subjects): rest vs multitasking. https://ieee-dataport.org/open-access/stew-simultaneous-task-eeg-workload-dataset
- **PhysioNet EEGMAT** (36 subjects, rest vs serial subtraction, 500 Hz, ODC-By). https://physionet.org/content/eegmat/
- **SAM40** (40 subjects, 32 ch, 128 Hz; use the raw folder). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8749216/
- **WESAD** (15 subjects, chest ECG/EDA/EMG/respiration plus wrist E4; TSST). https://archive.ics.uci.edu/dataset/465/wesad
- **EEGdenoiseNet** (4514 clean EEG, 3400 EOG, 5598 EMG segments). https://arxiv.org/pdf/2009.11662
- **Klados semi-simulated EOG** (CC BY). https://data.mendeley.com/datasets/wb6yvr725d/4
- **TUAR** artifact corpus (registration required). https://isip.piconepress.com/projects/tuh_eeg/html/downloads.shtml
- **Mendeley Muse 2** focus/relax/distraction (5 people). https://data.mendeley.com/datasets/g69dctrybk/1
- **Bird et al. Muse mental state** (Kaggle). https://www.kaggle.com/datasets/birdy654/eeg-brainwave-dataset-mental-state
- **Ultracortex MI** with deliberate blinks. https://data.mendeley.com/datasets/rz2jhpvhp3/2
- **Open MoBI** treadmill walking. https://figshare.com/collections/A_mobile_brain-body_imaging_dataset_recorded_during_treadmill_walking_with_a_brain-computer_interface/3894013

## J. Reusable software

| Tool | Notes |
|---|---|
| BrainFlow (MIT) | Board ids, DataFilter (wavelet, rolling filter, band powers), MLModel built-in. https://github.com/brainflow-dev/brainflow |
| NeuroKit2 (MIT) | ECG/PPG/HRV. https://neuropsychology.github.io/NeuroKit/ |
| HeartPy | MIT on the repo, but PyPI 1.1.x is GPL-3.0. |
| systole | Lipponen-Tarvainen beat correction. |
| pyRiemann (BSD-3) | Riemannian methods. |
| MNE-LSL (BSD-3) | Replaces MNE-Realtime. |
| meegkit | ASR, DSS, ZapLine. |
| asrpy | ASR port; not maintained. |
| Timeflux (MIT) + timeflux_rasr | Real-time framework with rASR. |
| JavaScript DSP | fili.js (IIR/FIR/FFT), neurosity/eeg-pipes, WebBCI. |
| Muse JavaScript | muse-js (stale), muse-jsx, web-muse. The panel already has its own BLE code; keep it. |
| OpenViBE (AGPL), BCI2000 (non-commercial), MetaBCI (GPL-2.0) | Reference only. |
