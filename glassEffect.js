import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

// Masks the HUD to a rounded rectangle. The backdrop blur fills the whole
// actor box, so without this its square corners poke out past the CSS
// border-radius.
const DECLARATIONS = `
uniform sampler2D tex;
uniform float radius;
uniform float width;
uniform float height;
`;

const CODE = `
vec2 uv = cogl_tex_coord_in[0].xy;
vec2 size = vec2(max(width, 1.0), max(height, 1.0));
vec2 p = uv * size - size * 0.5;
vec2 q = abs(p) - size * 0.5 + vec2(radius);
// Distance to the rounded edge: negative inside, positive outside.
float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - radius;
float cover = 1.0 - smoothstep(-0.75, 0.75, d);

vec4 c = texture2D(tex, uv);
cogl_color_out = c * cover;
`;

export const GlassEffect = GObject.registerClass({
    Properties: {
        'radius': GObject.ParamSpec.double('radius', null, null,
            GObject.ParamFlags.READWRITE, 0, 1000, 22),
    },
}, class GlassEffect extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet(Shell.SnippetHook.FRAGMENT, DECLARATIONS, CODE, true);
    }

    vfunc_paint_target(node, paintContext) {
        const actor = this.get_actor();
        const uniforms = {
            radius: this.radius,
            width: actor.width,
            height: actor.height,
        };
        for (const [name, value] of Object.entries(uniforms))
            this.set_uniform_float(this.get_uniform_location(name), 1, [value]);
        super.vfunc_paint_target(node, paintContext);
    }
});
