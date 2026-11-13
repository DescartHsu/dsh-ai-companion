/** Reserved extension contracts only. V0.1 does not invoke these providers. */
export interface CharacterView { setState(state: {mood:number; energy:number; bpm:number}): Promise<void>; dispose(): Promise<void>; }
export interface VoiceProvider { transcribe(audio:Uint8Array, signal:AbortSignal):Promise<string>; synthesize(text:string, signal:AbortSignal):Promise<Uint8Array>; }
export interface ImageProvider { generate(prompt:string, signal:AbortSignal):Promise<{path:string}>; }
export interface VideoProvider { generate(prompt:string, signal:AbortSignal):Promise<{jobId:string}>; poll(jobId:string, signal:AbortSignal):Promise<{status:'pending'|'done'|'failed'; path?:string}>; }
export interface ProactivePolicy { evaluate(input:{userId:string; lastInteraction:number; now:number}):Promise<{send:boolean; reason:string}>; }
