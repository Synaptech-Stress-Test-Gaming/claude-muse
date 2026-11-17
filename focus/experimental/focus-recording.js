/* Extra recording columns for the focus modes. Columns 0-13 of the recording are the panel's original ones and never change;
   everything here is appended after them (nothing renamed).
   Needs from the panel: S, FS, focus, pctOf. From the engine: fc, fg, CAL, CST_NAMES. From the switch: effMode. */
"use strict";
const FOCUS_REC_COLNAMES = [
  "focus_corrected_raw_ln","focus_corrected_ema_ln","focus_corrected_0_to_100","corrected_status","corrected_valid",
  "corrected_emg_ratio","corrected_beta_removed_frac","focus_displayed","focus_legacy_raw_ln",
  "focus_gateonly_raw_ln","focus_gateonly_ema_ln","focus_gateonly_0_to_100","gateonly_status","gateonly_valid"];
const FOCUS_REC_BASE = 14; // index of the first extra column
/* write one row's extra values. Text columns are stored as numeric codes and turned into words by focusRecFormat. */
function focusRecFill(d,o){
  const B=FOCUS_REC_BASE,hold=CAL?CAL.max_hold_s:3,t=S.emitted/FS;
  const one=(st,k)=>{
    const heldOut=st.t>=0&&(t-st.lastValidT)>hold,p=pctOf(st);
    d[o+k]=st.valid?st.raw:NaN;                         // raw ln (unsmoothed), empty when the window is invalid
    d[o+k+1]=st.ema==null||heldOut?NaN:st.ema;          // smoothed ln, empty once the hold exceeds max_hold_s
    d[o+k+2]=p==null||!st.valid?NaN:p;                  // 0 to 100
    d[o+k+3]=st.st;d[o+k+4]=st.st?(st.valid?1:0):NaN;   // status code, valid flag
  };
  one(fc,B);d[o+B+5]=fc.ratio;d[o+B+6]=fc.rem;          // corrected: emg_ratio, beta_removed_frac
  d[o+B+7]={legacy:0,corrected:1,gate:2}[effMode()];    // which score drove the panel
  d[o+B+8]=focus.raw==null?NaN:focus.raw;               // legacy raw ln (unsmoothed)
  one(fg,B+9);                                          // gate-only block
}
function focusRecFormat(c,v){
  if(c===21)return v===1?"corrected":v===2?"gate-only":"legacy"; // focus_displayed
  if(v!==v)return "";
  if(c===17||c===26)return CST_NAMES[v]||"";                      // corrected_status, gateonly_status
  if(c===18||c===27)return String(v);                             // valid flags
  return v.toFixed(4);
}
