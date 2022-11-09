from PIL import Image
from PIL import ImageFont
from PIL import ImageDraw, ImageFilter, ImageChops

import textwrap
import os

def clamp(num, min_value, max_value):
    # i still cant believe it's not native in python
    num = max(min(num, max_value), min_value)
    return num

class Coordinates:
    def __init__(self, x, y):
        self.x = x
        self.y = y

class Subtitle:
    def __init__(self, pos, text, font_name, font_size, shadow=False, shadow_offset=Coordinates(0,0), shadow_blur=3, max_lines=0, top=False, stroke=0, font_color=(255,255,255), stroke_color=(0, 0, 0), offset=Coordinates(0,0)):
        self.offset = offset
        self.pos = Coordinates(pos.x+self.offset.x, pos.y+self.offset.y)
        self.text = text
        self.font_name = font_name
        self.font_size = font_size
        self.font_color = font_color
        self.stroke = stroke
        self.stroke_color = stroke_color
        self.top = top
        self.max_lines = max_lines
        self.shadow = shadow
        self.shadow_offset = shadow_offset
        self.shadow_blur = shadow_blur
        self.create_font()

    def create_font(self):
        self.font_obj = ImageFont.truetype(self.font_name, self.font_size)
        bbox = self.font_obj.getbbox(self.text, stroke_width=self.stroke)
        char_bbox = self.font_obj.getbbox("W", stroke_width=self.stroke) # rough char size for wrapping
        self.text_size = Coordinates(bbox[2], bbox[3])
        self.char_size = Coordinates(char_bbox[2], char_bbox[3])

    def w_center(self, bg):
        self.pos.x = (bg.width - self.text_size.x) // 2

    def h_center(self, bg):
        self.pos.y = (bg.height - self.text_size.y) // 2

    def position(self, bg):
        if not self.top:
            self.pos.y = bg.height - self.pos.y*2 - self.char_size.y

    def fit(self, bg):
        while self.text_size.x > bg.width or self.text_size.y > bg.height:
            self.font_size -= 1
            self.create_font()

    def resize_down(self, bg):
        self.font_size -= 1
        self.create_font()

    def wrap(self, bg, max_lines=0):
        ''' wraps the current subtitle and returns new subtitle objects '''
        ''' you can set a limit to it and it'll fit the font instead '''
        try:
            sub_obj = []
            offset = Coordinates(0,0)
            max_iter = 500
            iteration = 0
            while True:
                iteration += 1
                if iteration > max_iter: # self.char_size is not very accurate therefore there is a possibility we might get stuck. if we do, resize the text to get unstuck!
                    self.resize_down(bg)
                wrapped = textwrap.wrap(self.text, bg.width//self.char_size.x*2)
                if max_lines != 0 and len(wrapped) > max_lines:
                    self.fit(bg)
                    continue
                for line in wrapped:
                    sub_obj.append(Subtitle(pos=self.pos, 
                                            text=line,
                                            font_name=self.font_name, 
                                            font_size=self.font_size, 
                                            stroke=self.stroke,
                                            offset=offset,
                                            shadow=self.shadow,
                                            shadow_offset=self.shadow_offset,
                                            shadow_blur=self.shadow_blur))
                    offset.y += self.char_size.y + 5
                break
            return sub_obj
        except Exception as e:
            print(e)
            return [self]

    def clamp(self, bg):
        if self.pos.x+self.char_size.x > bg.width:
            self.pos.x = clamp(self.pos.x-self.char_size.x, 0, bg.width)
        if self.pos.y+self.char_size.y > bg.height:
            self.pos.y = clamp(self.pos.y-self.char_size.y, 0, bg.height)

    def get_total_clamp_offset_y(self, bg, subtitles):
        offset = Coordinates(0,0)
        for i, sub in enumerate(subtitles):
            if i == 0:
                continue
            if sub.pos.y + sub.char_size.y > bg.height:
                offset.y -= sub.char_size.y
        return offset

    def draw(self, bg):
        if self.shadow:
            shadow_image = Image.new('RGBA', bg.size)
            shadow_canvas = ImageDraw.Draw(shadow_image)
            shadow_canvas.text((self.pos.x+self.shadow_offset.x, self.pos.y+self.shadow_offset.y), self.text, font=self.font_obj, fill=(0,0,0), stroke=1, stroke_fill=self.stroke_color)
            shadow_image = shadow_image.filter(ImageFilter.GaussianBlur(self.shadow_blur))
            bg.paste(shadow_image,shadow_image)
        draw = ImageDraw.Draw(bg)
        draw.text((self.pos.x, self.pos.y), self.text, font=self.font_obj, fill=self.font_color, stroke_width=self.stroke, stroke_fill=self.stroke_color)

class MakarovImage:
    def __init__(self, image_path):
        self.bg = Image.open(image_path)
        self.image_path = image_path

    def add_meme_subtitle(self, subtitles):
        for subtitle_hl in subtitles:
            subtitle_hl.clamp(self.bg)
            subtitle_hl.position(self.bg)
            wrapped_subtitles = subtitle_hl.wrap(self.bg, max_lines=subtitle_hl.max_lines)
            offset = subtitle_hl.get_total_clamp_offset_y(self.bg, wrapped_subtitles)
            for subtitle_ll in wrapped_subtitles:
                subtitle_ll.pos.y += offset.y
                subtitle_ll.w_center(self.bg)
                subtitle_ll.draw(self.bg)

    def add_vertical_gradient(self, gradient_magnitude=5):
        if self.bg.mode != 'RGBA':
            self.bg = self.bg.convert('RGBA')
        bg_size = Coordinates(self.bg.size[0], self.bg.size[1])
        gradient = Image.new('L', (1, bg_size.y), color=0xFF)
        for y in range(bg_size.y):
            gradient.putpixel((0, -y), int(255 * (1 - gradient_magnitude * float(y)/bg_size.y)))
        alpha = gradient.resize(self.bg.size)
        black_im = Image.new('RGBA', self.bg.size, color=0)
        black_im.putalpha(alpha)
        self.bg = Image.alpha_composite(self.bg, black_im)
        
    def save(self):
        pathname, extension = os.path.splitext(self.image_path)
        # Saving the image in anything else but jpg may cause transparency issues. BE AWARE!!
        path = "m_" + pathname + ".jpg"
        self.bg = self.bg.convert("RGB")
        self.bg.save(path, quality=100)
        return path

if __name__ == "__main__":
    img = MakarovImage("sample.jpg")
    subtitle = Subtitle(pos=Coordinates(x=10,y=10),
                        text="lol",
                        font_name="../internal/lobster.ttf",
                        font_size=32,
                        shadow=True,
                        shadow_offset=Coordinates(1,1),
                        shadow_blur=2,
                        max_lines=2,
                        top=False)
    img.add_vertical_gradient(8)
    img.add_meme_subtitle([subtitle])
    path = img.save()
