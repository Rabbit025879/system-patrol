import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

// Warps the HUD like a genie leaving its bottle. At progress 0 the whole HUD
// is squeezed into a thin strip along its top edge with the top row pinched to
// a point; as the progress rises the strip grows downward and the pinch
// widens into the full window. The caller moves the actor so that the pinched
// top sits on the button the HUD comes out of.
const DECLARATIONS = `
uniform sampler2D tex;
uniform float progress;
`;

const CODE = `
vec2 uv = cogl_tex_coord_in[0].xy;
float p = clamp(progress, 0.001, 1.0);

// Source row: the whole window is compressed into the top p of the box.
float row = uv.y / p;
if (row > 1.0) {
    cogl_color_out = vec4(0.0);
} else {
    float t = 1.0 - row;
    float pinch = pow(t, 1.5) * (1.0 - p);
    float w = max(mix(1.0, 0.04, pinch), 0.001);
    float col = (uv.x - 0.5) / w + 0.5;
    if (col < 0.0 || col > 1.0)
        cogl_color_out = vec4(0.0);
    else
        cogl_color_out = texture2D(tex, vec2(col, row));
}
`;

export const GenieEffect = GObject.registerClass({
    Properties: {
        'progress': GObject.ParamSpec.double('progress', null, null,
            GObject.ParamFlags.READWRITE, 0, 1, 0),
    },
}, class GenieEffect extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet(Shell.SnippetHook.FRAGMENT, DECLARATIONS, CODE, true);
    }

    vfunc_paint_target(node, paintContext) {
        this.set_uniform_float(this.get_uniform_location('progress'), 1, [this.progress]);
        super.vfunc_paint_target(node, paintContext);
    }
});
