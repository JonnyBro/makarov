import os
from urllib.request import urlopen, Request
from urllib.parse import urlparse
from textwrap import wrap
from wand.image import Image
from wand.drawing import Drawing
from wand.font import Font
from wand.color import Color
from random import choice
from functools import wraps, partial
from time import time
import asyncio

egh_blurb = ["1080p 60fps", "h@s", "pedo", "ped0","crackhead", "l0ser", "tiny", "short", "james", "tilar", "femboy", "rud", "sentor", "snowy", "she", "her", "he", "owned",
             "DOMINATED", "HVH", "In HVH!", "squat", "pedo squat", "rq", "RQs", "coby", "enzic", "static", "james", "hey nick", "smokes week l0l", "l0l", "feet pics",
             "georgie", "newgen ped0", "they RQ", "whole crew", "crew", "newgen", "D0minated", "pasted", "rat scams",
             "scams", "DONT BUY", "tranny", "IRL", "mexican spec", "virgin", "nicklous becker", "becker", "david hancock",
             "her crew", "medic gf", "cpg", "go medic", "low t", "clownsquat", "rejin", "rijin", "nitro", "small"]

dox_blurb = ["slave", "finally dead", "killed him", "depressed", "fuck", "very", "deep", "hard", "sad", "mental", "mentally", "ill", "I",
               "kill", "pasters", "destroy", "tomas curda", "rud", "john", "slave paster", "rotten", "mans", "dox", "cheaters", "lovers", "your mother", 
               "john paster", "!!!!!!", "mouth", "deep", "senator", "dqz", "everyday", "slave of", "rijin", "lithium", "who was slave of", "lmaobox", 
               "nullcore", "aimware", "now slave of", "dox and kill all cheaters"]

def async_wrap(func):
    ''' Wrapper for sync functions to make them async '''
    @wraps(func)
    async def run(*args, loop=None, executor=None, **kwargs):
        if loop is None:
            loop = asyncio.get_event_loop()
        pfunc = partial(func, *args, **kwargs)
        return await loop.run_in_executor(executor, pfunc)
    return run

class ImageGenerator():
    def __init__(self, typee, inputt):
        self.image_path = inputt
        self.type = typee
        match typee:
            case "link":
                req = Request(
                    self.image_path, 
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36'}
                )
                image_file = urlopen(req) 
                self.img = Image(file=image_file)
            case "path":
                with open(self.image_path, "rb") as f:
                    self.img = Image(file=f)
            case "solid_color":
                self.img = Image(width=1280, height=720, pseudo="xc:" + self.image_path)

    @staticmethod
    def eval_metrics(ctx, image, txt):
        """Quick helper function to calculate width/height of text."""
        metrics = ctx.get_font_metrics(image, txt, True)
        return (metrics.text_width, metrics.text_height)

    @staticmethod
    def word_wrap(image, ctx, text, roi_width, roi_height, padding_x=0, padding_y=0):
        """Break long text to multiple lines, and reduce point size
        until all text fits within a bounding box."""
        mutable_message = text
        iteration_attempts = 0
        emergency_string_cut_index = 0

        def eval_metrics(txt):
            """Quick helper function to calculate width/height of text."""
            metrics = ctx.get_font_metrics(image, txt, True)
            return (metrics.text_width, metrics.text_height)
        while ctx.font_size > 0:
            iteration_attempts += 1

            if iteration_attempts > 100:
                mutable_message = mutable_message[:-emergency_string_cut_index]
                emergency_string_cut_index += 1
            width, height = eval_metrics(mutable_message)
            if (height > roi_height - padding_y):
                ctx.font_size -= 0.75  # Reduce pointsize
                mutable_message = text  # Restore original text
            elif (width > roi_width - padding_x):
                columns = len(mutable_message)
                while columns > 0:
                    columns -= 1
                    mutable_message = '\n'.join(wrap(mutable_message, columns))
                    wrapped_width, _ = eval_metrics(mutable_message)
                    if wrapped_width <= roi_width - padding_x:
                        break
                if columns < 1:
                    ctx.font_size -= 0.75  # Reduce pointsize
                    mutable_message = text  # Restore original text
            else:
                break

        return mutable_message

    def get_context_for_basic(self, font, size=None):
        if not size:
            size = max(self.img.width * self.img.height / 100000 * 3, 48)
        draw = Drawing()
        draw.font_name = font
        draw.font_size = size
        return draw

    def add_text_basic(self, text, x=None, y=None, font="arial.ttf", padding_x=None, padding_y=None, color=Color("#ffffff"), size=None, gravity="north_west"):
        if not size:
            size = max(self.img.width * self.img.height / 100000 * 3, 48)

        if not padding_y:
            padding_y = int(self.img.height * (1/50))

        if not padding_x:
            padding_x = int(self.img.width * (1/50))

        factor = 1
        if self.img.width < 1000 or self.img.height < 1000:
            factor = int((1000/self.img.width + 1000/self.img.height) / 2) + 1

        font_base = Font(font, size=size*factor, color=color)

        big_image_text = Image(width=self.img.width*factor, height=self.img.height*factor)
        big_image_text.background_color = Color("#00000000")
        big_image_text.caption(text, font=font_base, gravity=gravity)

        end_img = big_image_text
        
        end_img.trim(Color("#00000000"))
        end_img.resize(width=end_img.width//factor, height=end_img.height//factor)
        end_img.border(Color("#00000000"), padding_x, padding_y)

        self.img.composite(image=end_img, operator="over", gravity="center")     

    def add_text(self, text, gravity="north", font="impact.ttf", color=Color("#ffffff"), size=None, stroke_width=0, padding_y=0, padding_x=0, shadow=0, shadow_offset=(0,0), correct_for_italic=None):
        ''' holy grail of dumb hacks to make it work how i want it '''
        ''' takes a pretty long time to generate '''

        #draw = Drawing()

        if not size:
            size = max(self.img.width * self.img.height / 100000 * 3, 32)

        if not padding_y:
            padding_y = int(self.img.height * (1/50))

        if not padding_x:
            padding_x = int(self.img.width * (1/50))

        italic_x_offset = 0
        if correct_for_italic:
            italic_x_offset = correct_for_italic

        factor = 1

        if self.img.width < 1000 or self.img.height < 1000:
            factor = int((1000/self.img.width + 1000/self.img.height) / 2 + 1)

        factored_width = int(self.img.width*factor)
        factored_height = int(self.img.height*factor)

        font_base = Font(font, size=size*factor, color=color, stroke_color=Color("#00000000"), stroke_width=size * 0.15 * stroke_width * factor)
        font_outline = Font(font, size=size*factor, color=Color("#000000"), stroke_color=Color("#000000"), stroke_width=size * 0.15 * stroke_width * factor)
        font_shadow = Font(font, size=size*factor, color=Color("#000000F1"), stroke_color=Color("#000000F1"), stroke_width=size * 0.15 * stroke_width * factor)

        big_image_text = Image(width=factored_width, height=factored_height)
        big_image_text.background_color = Color("#00000000")
        big_image_text.caption(text, font=font_base, gravity="center", left=italic_x_offset)
        #big_image_text.trim(Color("#00000000"))

        end_img = big_image_text
        
        if stroke_width > 0:
            big_image_border = Image(width=factored_width, height=factored_height)
            big_image_border.background_color = Color("#00000000")
            big_image_border.caption(text, font=font_outline, gravity="center", left=italic_x_offset)
            big_image_border.composite_channel(channel="alpha", image=end_img, operator="over")
            end_img = big_image_border

        if shadow > 0:
            img_shadow = Image(width=factored_width, height=factored_height)
            img_shadow.caption(text, font=font_shadow, left=italic_x_offset, gravity="center")
            img_shadow.blur(sigma=shadow*factor*5)
            img_shadow.resize(width=end_img.width, height=end_img.height)
            img_shadow.composite_channel(channel="all", image=end_img, operator="over")
            end_img = img_shadow

        end_img.trim(Color("#00000000"))
        end_img.resize(width=int(end_img.width/factor), height=int(end_img.height/factor))
        end_img.border(Color("#00000000"), padding_x, padding_y)

        self.img.composite(image=end_img, operator="over", gravity=gravity)

    def add_vertical_gradient(self, factor=0.1, start=0, end=0.4):
        canvas = Image(width=self.img.width, height=int(self.img.height*factor), pseudo=f"gradient:rgba(0,0,0,{start})-rgba(0,0,0,{end})")

        self.img.composite_channel(channel="all", image=canvas, top=int(self.img.height*(1-factor))+2, operator="over")

    def save(self):
        pathname, extension = os.path.splitext(self.image_path)
        if self.type == "file":
            parsed_url = urlparse(self.image_path)
            pathname, extension = os.path.splitext(os.path.basename(parsed_url.path))
        path = f"{round(time())}_output.png"
        self.img.save(filename=path)
        return path  

class MemesGenerator:
    @staticmethod
    @async_wrap
    def gen_egh():
        # this sucks lol
        file = choice(os.listdir(f"internal/egh_pics/"))
        style = choice(["solid_color", "path"])
        color = "#10AA10"
        if style == "solid_color":
            img = ImageGenerator(typee="solid_color", inputt=color)

            buffer = choice(egh_blurb) + " "
            end_result = buffer

            char_size = img.eval_metrics(img.get_context_for_basic(font="internal/arial.ttf"), img.img, buffer)

            while img.eval_metrics(img.get_context_for_basic(font="internal/arial.ttf"), img.img, end_result)[1] < img.img.height + 64:
                while img.eval_metrics(img.get_context_for_basic(font="internal/arial.ttf"), img.img, buffer)[0] < img.img.width:
                    buffer += choice(egh_blurb) + " "
                end_result += buffer + "\n"
                buffer = choice(egh_blurb) + " "

            img.add_text_basic(end_result.replace("\n", ""))
            return img.save()
        elif style == "path":
            img = ImageGenerator(typee="path", inputt=f"internal/egh_pics/"+file)

            buffer = choice(egh_blurb) + " "
            end_result = buffer

            char_size = img.eval_metrics(img.get_context_for_basic(font=f"internal/roman.ttf"), img.img, buffer)

            while img.eval_metrics(img.get_context_for_basic(font=f"internal/roman.ttf"), img.img, end_result)[1] < img.img.height + 64:
                while img.eval_metrics(img.get_context_for_basic(font=f"internal/roman.ttf"), img.img, buffer)[0] < img.img.width:
                    buffer += choice(egh_blurb) + " "
                end_result += buffer + "\n"
                buffer = choice(egh_blurb) + " "

            img.add_text_basic(end_result.replace("\n", ""), font=f"internal/roman.ttf", color=Color("#10FF10"))
            return img.save()

    @staticmethod
    @async_wrap
    def gen_crazy_doxxer():
        color = "#101010"
        img = ImageGenerator(typee="solid_color", inputt=color)

        buffer = choice(dox_blurb) + " "
        end_result = buffer

        char_size = img.eval_metrics(img.get_context_for_basic(font="internal/arial.ttf"), img.img, buffer)

        while img.eval_metrics(img.get_context_for_basic(font="internal/arial.ttf"), img.img, end_result)[1] < img.img.height + 64:
            while img.eval_metrics(img.get_context_for_basic(font="internal/arial.ttf"), img.img, buffer)[0] < img.img.width:
                buffer += choice(dox_blurb) + " "
            end_result += buffer + "\n"
            buffer = choice(dox_blurb) + " "

        img.add_text_basic(end_result.replace("\n", ""), size=48)
        return img.save()

    @staticmethod
    @async_wrap
    def gen_impact(inputt, texts=[], typee="link", gravity=[]):
        img = ImageGenerator(typee, inputt)
        for i, text in enumerate(texts):
            img.add_text(text.upper(), gravity=gravity[i], font=f"internal/impact.ttf", stroke_width=2)
        return img.save()

    @staticmethod
    @async_wrap
    def gen_lobster(typee, inputt, text):
        img = ImageGenerator(typee, inputt)
        img.add_vertical_gradient()
        img.add_text(text, gravity="south", font=f"internal/lobster.ttf", shadow=1, correct_for_italic=15)
        return img.save()

# gen_impact(typee="path", inputt="y9Di3zHOOas.jpg", texts=["lol", "kill yourself"], gravity=["north", "south"])
# gen_lobster(typee="path", inputt="y9Di3zHOOas.jpg", text="lol")

#MemesGenerator.gen_egh()
#MemesGenerator.gen_crazy_doxxer()