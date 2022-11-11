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

    def __add__(self, point):
        if type(point).__name__ == "Coordinates":
            return Coordinates(self.x + point.x, self.y + point.y)
        elif type(point).__name__ in ["list", "tuple", "set"]:
            return Coordinates(self.x + point[0], self.y + point[1])

    def __radd__(self, point):
        return self.__add__(point)

    def __sub__(self, point):
        if type(point).__name__ == "Coordinates":
            return Coordinates(self.x - point.x, self.y - point.y)
        elif type(point).__name__ in ["list", "tuple", "set"]:
            return Coordinates(self.x - point[0], self.y - point[1])

    def __mul__(self, point):
        if type(point).__name__ == "Coordinates":
            return Coordinates(self.x * point.x, self.y * point.y)
        elif type(point).__name__ in ["list", "tuple", "set"]:
            return Coordinates(self.x * point[0], self.y * point[1])
        else:
            return Coordinates(self.x * point, self.y * point)

    def __repr__(self):
        return f"Coordinates({self.x}, {self.y})"

    def __str__(self):
        return f"{self.x}:{self.y}"

    def get_list(self):
        return (self.x, self.y)


class Text:
    def __init__(self, text, origin, position, max_wrap_lines, font_name, font_size, font_color, stroke_size, stroke_color, shadow, shadow_offset, shadow_blur, padding, after_fitting=False):
        self.text = text
        self.origin = origin
        self.position = position 
        self.max_wrap_lines = max_wrap_lines
        self.font_name = font_name
        self.font_size = font_size
        self.font_color = font_color 
        self.stroke_size = stroke_size
        self.stroke_color = stroke_color
        self.shadow = shadow
        self.shadow_offset = shadow_offset 
        self.shadow_blur = shadow_blur
        self.after_fitting = after_fitting
        self.padding = padding

        self.init_font()

    def init_font(self):
        self.font = ImageFont.truetype(self.font_name, self.font_size)
        self.bbox = self.font.getbbox(self.text, stroke_width=self.stroke_size)
        self.text_size = Coordinates(self.bbox[2]-self.bbox[0], self.bbox[3]-self.bbox[1])
        self.char_width = self.text_size.x / len(self.text)

    def set_bg(self, bg):
        self.bg = bg

    def place(self):
        if self.position == "bottom":
            print(self.text_size)
            self.origin.y = self.bg.height - self.origin.y - self.text_size.y

    def center(self, w=False, h=False):
        if w:
            self.origin.x = self.bg.width / 2
        if h:
            self.origin.y = self.bg.height / 2

    def set_origin_together(self, subtitle_list, point):
        ''' unused '''
        for subtitle in subtitle_list:
            rel_coordinates = self.origin - subtitle.origin
            subtitle.origin = point + rel_coordinates
        self.origin = point

    def get_size_together(self, subtitle_list):
        ''' get the text size '''

        x_coordinates = [subtitle.origin.x for subtitle in subtitle_list]
        y_coordinates = [subtitle.origin.y for subtitle in subtitle_list]

        x_max = max(x_coordinates)
        y_max = max(y_coordinates)
        x_min = min(x_coordinates)
        y_min = min(y_coordinates)

        return Coordinates(x_max - x_min, y_max-y_min)

    def is_oob(self, return_offset=False, correct=False, custom_size=None):
        ''' checks if the text object is out of bounds '''
        size = self.text_size
        if custom_size:
            size = custom_size
        offset = Coordinates(0,0)
        oob = False

        if self.origin.x - size.x/2 - self.padding.x < 0:
            if return_offset:
                offset.x = self.origin.x - size.x/2 - self.padding.x
            oob = True

        if self.origin.x + size.x/2 + self.padding.x > self.bg.width:
            if return_offset:
                offset.x = (self.origin.x + size.x/2 + self.padding.x) - self.bg.height
            oob = True

        if self.origin.y - size.y/2 - self.padding.y < 0:
            if return_offset:
                offset.y = self.origin.y - size.y/2 - self.padding.y
            oob = True

        if self.origin.y + size.y/2 + self.padding.y > self.bg.height:
            if return_offset:
                offset.y = (self.origin.y + size.y/2 + self.padding.y) - self.bg.height
            oob = True

        if correct:
            self.origin = self.origin - offset

        if return_offset:
            return offset

        return oob

    def fit(self):
        ''' weird hacky way to fit text onto the image with both text wrapping and resizing
            you can control its behaviour when creating the text object by using self.max_wrap_lines
        '''
        while self.is_oob():
            wrapped = textwrap.wrap(self.text, self.bg.width//self.char_width-2)
            if self.max_wrap_lines > 0 and len(wrapped) > self.max_wrap_lines:
                self.font_size -= 1
                self.init_font()
                continue

            subtitles = []
            wrap_offset = Coordinates(0,0)
            oob_offset = Coordinates(0,0)
            for line in reversed(wrapped):
                if self.position == "top":
                    origin_sub = wrap_offset
                else:
                    origin_sub = wrap_offset * -1                    
                temp_subtitle = Text(text = self.text,
                                    origin = self.origin - wrap_offset,
                                    position = self.position,
                                    max_wrap_lines = self.max_wrap_lines,
                                    font_name = self.font_name,
                                    font_size = self.font_size,
                                    font_color  = self.font_color,
                                    stroke_size = self.stroke_size,
                                    stroke_color = self.stroke_color,
                                    shadow = self.shadow,
                                    shadow_offset = self.shadow_offset,
                                    shadow_blur = self.shadow_blur,
                                    padding = self.padding,
                                    after_fitting=True)
                wrap_offset.y += temp_subtitle.text_size.y + 5
                temp_subtitle.set_bg(self.bg)
                temp_subtitle.text = line
                temp_subtitle.init_font()
                subtitles.append(temp_subtitle)

            if self.position == "top":
                for i, subtitle in enumerate(subtitles):
                    subtitle.origin = subtitle.origin + origin_sub
                    oob_offset = subtitle.is_oob(return_offset=True)

                for i, subtitle in enumerate(subtitles):
                    subtitle.origin = subtitle.origin - oob_offset
            elif self.position == "bottom":
                for i, subtitle in enumerate(subtitles):
                    oob_offset = subtitle.is_oob(return_offset=True)

                for i, subtitle in enumerate(subtitles):
                    subtitle.origin = subtitle.origin - oob_offset            
            
            return subtitles

    def draw(self):
        if self.shadow:
            shadow_image = Image.new('RGBA', self.bg.size)
            shadow_canvas = ImageDraw.Draw(shadow_image)
            shadow_pos = self.origin + self.shadow_offset
            shadow_canvas.text(shadow_pos.get_list(), self.text, font=self.font, fill=(0,0,0), stroke=1, stroke_fill=self.stroke_color, anchor="mm")
            shadow_image = shadow_image.filter(ImageFilter.GaussianBlur(self.shadow_blur))
            self.bg.paste(shadow_image, shadow_image)
        draw = ImageDraw.Draw(self.bg)
        #self.origin = self.origin - Coordinates(0, -100)
        anchor = "mm"
        draw.text(self.origin.get_list(), self.text, font=self.font, fill=self.font_color, stroke_width=self.stroke_size, stroke_fill=self.stroke_color, anchor=anchor)


class MakarovImage:
    def __init__(self, image_path):
        self.bg = Image.open(image_path)
        self.image_path = image_path
        self.size = Coordinates(self.bg.size[0], self.bg.size[1])

    def add_meme_subtitle(self, subtitles):
        for subtitle_hl in subtitles:
            subtitle_hl.set_bg(self.bg)
            subtitle_hl.place()
            #subtitle_hl.is_oob(correct=True, return_offset=True)
            wrapped_subtitles = subtitle_hl.fit()
            for subtitle in wrapped_subtitles:
                subtitle.center(w=True, h=False)
                subtitle.draw()

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
    subtitle = Text(text=("lmfao i hate pancakes".upper()+" ")*1, origin=Coordinates(0,0), position="top",
                    max_wrap_lines=2, font_name="../internal/impact.ttf", font_size=32,
                    font_color=(255,255,255), stroke_size=2, stroke_color=(0,0,0),
                    shadow=False, shadow_offset=Coordinates(1,1), shadow_blur=2, padding=Coordinates(0,20))
    subtitle2 = Text(text=("lmfao i hate pancakes".upper()+" ")*1, origin=Coordinates(0,0), position="bottom",
                    max_wrap_lines=2, font_name="../internal/impact.ttf", font_size=32,
                    font_color=(255,255,255), stroke_size=2, stroke_color=(0,0,0),
                    shadow=False, shadow_offset=Coordinates(1,1), shadow_blur=2, padding=Coordinates(0,20))
    img.add_meme_subtitle([subtitle, subtitle2])
    path = img.save()
