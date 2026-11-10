(function(){
  "use strict";
  const list = [
  {
    "key": "cbuffer",
    "title": "Constant buffer",
    "what": "Defines read-only values shared across shader threads.",
    "does": "The host updates its fields between dispatches.",
    "use": "Declare it with a register and respect 16-byte packing.",
    "example": "cbuffer WorkbenchFrame : register(b7) {\n    float Time;\n    float3 Padding;\n};"
  },
  {
    "key": "register",
    "title": "Resource register",
    "what": "Names a buffer or resource binding in HLSL.",
    "does": "The host connects the matching GPU resource.",
    "use": "Use b for constant buffers, t for reads, and u for writable data.",
    "example": "RWStructuredBuffer<float4> Pixels : register(u0);"
  },
  {
    "key": "RWStructuredBuffer",
    "title": "Writable structured buffer",
    "what": "Stores an array of values the GPU can modify.",
    "does": "Each compute thread may write its assigned element.",
    "use": "Provide a matching buffer and avoid overlapping writes.",
    "example": "RWStructuredBuffer<float4> Framebuffer : register(u0);\nFramebuffer[index] = float4(1, 0, 0, 1);"
  },
  {
    "key": "StructuredBuffer",
    "title": "Read-only structured buffer",
    "what": "Reads a typed array supplied by the host.",
    "does": "Threads access elements by index.",
    "use": "Check the index against the buffer length.",
    "example": "StructuredBuffer<float4> Input : register(t0);\nfloat4 value = Input[index];"
  },
  {
    "key": "numthreads",
    "title": "Compute group size",
    "what": "Sets the number of threads in each compute workgroup.",
    "does": "It changes how dispatch groups cover your grid.",
    "use": "Use one, two, or three dimensions and check bounds.",
    "example": "[numthreads(8, 8, 1)]\nvoid CSMain(uint3 tid : SV_DispatchThreadID) { }"
  },
  {
    "key": "SV_DispatchThreadID",
    "title": "Dispatch thread ID",
    "what": "Provides a thread's global X, Y, and Z indices.",
    "does": "Each invocation receives its own coordinates.",
    "use": "Use it to locate a pixel or buffer element.",
    "example": "uint index = tid.y * WORKBENCH_WIDTH + tid.x;"
  },
  {
    "key": "uint3",
    "title": "Unsigned 3D vector",
    "what": "Holds three unsigned 32-bit integers.",
    "does": "Compute shaders use it for dispatch coordinates.",
    "use": "Access x, y, and z components.",
    "example": "uint3 id = tid;\nuint x = id.x;"
  },
  {
    "key": "float",
    "title": "32-bit float",
    "what": "Stores one floating-point value.",
    "does": "Use it for time, distance, and intensity.",
    "use": "Use `f` suffixes for numeric HLSL constants when useful.",
    "example": "float radius = 0.25f;"
  },
  {
    "key": "float2",
    "title": "2D float vector",
    "what": "Stores a pair of floating-point values.",
    "does": "Useful for UVs, positions, and directions.",
    "use": "Access components with .x/.y or .xy.",
    "example": "float2 uv = float2(0.5f, 0.25f);"
  },
  {
    "key": "float3",
    "title": "RGB or 3D vector",
    "what": "Stores three floating-point values.",
    "does": "Used for RGB colors and 3D coordinates.",
    "use": "Assign components explicitly or use swizzles.",
    "example": "float3 rgb = float3(1.0f, 0.2f, 0.1f);"
  },
  {
    "key": "float4",
    "title": "RGBA or 4D vector",
    "what": "Stores four floating-point values.",
    "does": "The Workbench framebuffer interprets it as RGBA.",
    "use": "Write red, green, blue, and alpha in that order.",
    "example": "Framebuffer[i] = float4(rgb, 1.0f);"
  },
  {
    "key": "uint",
    "title": "Unsigned integer",
    "what": "Stores a non-negative 32-bit integer.",
    "does": "Often used for indices and loop counters.",
    "use": "Check bounds before indexing buffers.",
    "example": "uint index = tid.x;"
  },
  {
    "key": "define",
    "title": "Preprocessor define",
    "what": "Assigns a textual compile-time constant.",
    "does": "The compiler substitutes it before generating shader code.",
    "use": "Use a simple name and fixed value.",
    "example": "#define WORKBENCH_WIDTH 256"
  },
  {
    "key": "if",
    "title": "Conditional branch",
    "what": "Runs code only when a condition is true.",
    "does": "Used for clipping, bounds, and special colors.",
    "use": "Keep all buffer accesses within valid bounds.",
    "example": "if (tid.x >= WORKBENCH_WIDTH) return;"
  },
  {
    "key": "for",
    "title": "Counted loop",
    "what": "Repeats shader statements a bounded number of times.",
    "does": "Useful for fractal iterations and particle sampling.",
    "use": "Keep loops finite to avoid GPU timeouts.",
    "example": "for (uint n = 0u; n < 64u; ++n) { /* work */ }"
  },
  {
    "key": "loop",
    "title": "Loop attribute",
    "what": "Hints that the compiler should preserve a loop.",
    "does": "Useful when iteration counts vary per pixel.",
    "use": "Do not create infinite compute loops.",
    "example": "[loop]\nfor (uint i = 0u; i < 100u; ++i) { }"
  },
  {
    "key": "return",
    "title": "Return",
    "what": "Ends the current shader invocation or function.",
    "does": "Bounds checks often return early.",
    "use": "Avoid writing beyond output dimensions.",
    "example": "if (tid.x >= WORKBENCH_WIDTH) return;"
  },
  {
    "key": "Time",
    "title": "Workbench time",
    "what": "Contains elapsed animation time in seconds.",
    "does": "The browser host updates it before each GPU dispatch.",
    "use": "Read Time to animate positions or colors.",
    "example": "float pulse = 0.5f + 0.5f * sin(Time);"
  },
  {
    "key": "DeltaTime",
    "title": "Frame duration",
    "what": "Contains the last animation frame interval in seconds.",
    "does": "The host clamps large frame gaps.",
    "use": "Use it for frame-rate-independent movement.",
    "example": "position += velocity * DeltaTime;"
  },
  {
    "key": "Frame",
    "title": "Frame index",
    "what": "Counts completed or scheduled animation frames.",
    "does": "The host advances it each GPU frame.",
    "use": "Use it for deterministic frame-based changes.",
    "example": "float phase = Frame * 0.02f;"
  },
  {
    "key": "Framebuffer",
    "title": "RGBA framebuffer",
    "what": "Names the Workbench's writable pixel array.",
    "does": "The viewer shows the shader's exact RGBA output.",
    "use": "Index with y * width + x and write float4.",
    "example": "Framebuffer[tid.y * WORKBENCH_WIDTH + tid.x] = float4(1,0,0,1);"
  },
  {
    "key": "CSMain",
    "title": "Compute entry point",
    "what": "Is the function the compute pipeline dispatches.",
    "does": "The host looks for this entry in the compiled WGSL.",
    "use": "Declare it with the correct thread ID semantic.",
    "example": "[numthreads(8,8,1)]\nvoid CSMain(uint3 tid : SV_DispatchThreadID) { }"
  },
  {
    "key": "lerp",
    "title": "Linear interpolation",
    "what": "Blends between values a and b by factor t.",
    "does": "t=0 selects a; t=1 selects b.",
    "use": "Use t between 0 and 1 for a normal blend.",
    "example": "float3 color = lerp(blue, orange, 0.5f);"
  },
  {
    "key": "smoothstep",
    "title": "Smooth transition",
    "what": "Returns a smooth 0–1 transition between two edges.",
    "does": "Useful for circles, masks, and soft particle boundaries.",
    "use": "Keep the lower edge below the upper edge.",
    "example": "float alpha = 1.0f - smoothstep(0.10f, 0.15f, distance);"
  },
  {
    "key": "saturate",
    "title": "Clamp 0–1",
    "what": "Clamps a scalar or vector to the 0–1 range.",
    "does": "Keeps output color channels within normalized range.",
    "use": "Apply it before writing unclamped computed RGB.",
    "example": "rgb = saturate(rgb);"
  },
  {
    "key": "length",
    "title": "Vector length",
    "what": "Calculates the magnitude of a vector.",
    "does": "Often used for radial distance.",
    "use": "Subtract the center before measuring distance.",
    "example": "float distance = length(uv - center);"
  },
  {
    "key": "dot",
    "title": "Dot product",
    "what": "Multiplies and sums matching vector components.",
    "does": "Used for distance-squared and lighting.",
    "use": "Use dot(v,v) when you can avoid a square root.",
    "example": "float d2 = dot(delta, delta);"
  },
  {
    "key": "sin",
    "title": "Sine",
    "what": "Returns the sine of an angle in radians.",
    "does": "Useful for periodic animation.",
    "use": "Feed it Time multiplied by a speed.",
    "example": "float wave = sin(Time * 2.0f);"
  },
  {
    "key": "cos",
    "title": "Cosine",
    "what": "Returns the cosine of an angle in radians.",
    "does": "Useful for circular or oscillating motion.",
    "use": "Pair it with sin to create a rotating direction.",
    "example": "float2 direction = float2(cos(Time), sin(Time));"
  },
  {
    "key": "pow",
    "title": "Power",
    "what": "Raises a value to a specified exponent.",
    "does": "Can reshape masks and fractal palettes.",
    "use": "Use non-negative bases for fractional exponents.",
    "example": "float brightness = pow(saturate(t), 0.6f);"
  },
  {
    "key": "exp",
    "title": "Exponential",
    "what": "Computes e raised to a value.",
    "does": "Useful for soft glows and decay.",
    "use": "Use negative distance-squared for radial falloff.",
    "example": "float glow = exp(-distanceSquared * 40.0f);"
  },
  {
    "key": "frac",
    "title": "Fractional part",
    "what": "Returns the non-integer part of a value.",
    "does": "Useful for tiling and repeating motion.",
    "use": "Combine with abs to form bouncing motion.",
    "example": "float bounce = 1.0f - abs(frac(t) * 2.0f - 1.0f);"
  },
  {
    "key": "max",
    "title": "Maximum",
    "what": "Chooses the larger of two values.",
    "does": "Often protects a denominator from zero.",
    "use": "Use a small positive minimum for divisions.",
    "example": "float safeZoom = max(Zoom, 0.01f);"
  },
  {
    "key": "min",
    "title": "Minimum",
    "what": "Chooses the smaller of two values.",
    "does": "Useful for bounds and caps.",
    "use": "Use it to limit the size of a value.",
    "example": "float capped = min(value, 1.0f);"
  },
  {
    "key": "clamp",
    "title": "Clamp range",
    "what": "Limits a value to a lower and upper bound.",
    "does": "Useful for UVs, colors, and parameters.",
    "use": "Pass lower and upper values in that order.",
    "example": "float x = clamp(value, 0.0f, 1.0f);"
  },
  {
    "key": "GetDimensions",
    "title": "Buffer dimensions",
    "what": "Queries the element count and stride of a buffer.",
    "does": "Avoids hardcoding a dispatch bound.",
    "use": "Read the returned dimensions before indexing.",
    "example": "uint count, stride;\nInput.GetDimensions(count, stride);"
  }
];
  const lookup=Object.create(null);
  for(const item of list) lookup[item.key]=item;
  window.HLSLDocs={list,lookup,get(name){return lookup[name]||lookup[(name||"").replace(/^[#]/,"")]||null;}};
})();
