import random
import argparse
from collections import defaultdict
import sys
import queue
import re

def get_next_state(markov_chain, state):
    next_state_items = list(markov_chain[state].items())
    next_states = [x[0] for x in next_state_items]
    next_state_counts = [x[1] for x in next_state_items]
    total_count = sum(next_state_counts)
    next_state_probabilities = []
    probability_total = 0
    for next_state_count in next_state_counts:
        probability = float(next_state_count) / total_count
        probability_total += probability
        next_state_probabilities.append(probability_total)
    sample = random.random()
    for index, next_state_probability in enumerate(next_state_probabilities):
        if sample <= next_state_probability:
            return next_states[index]
    return None

def tokenise_text_file(file_name):
    with open(file_name, 'r', encoding="utf-8", errors="ignore") as file:
        return ' '.join(file).split()

def create_markov_chain(tokens, order):
    if order > len(tokens):
        raise Exception('Order greater than number of tokens.')
    markov_chain = defaultdict(lambda: defaultdict(int))
    current_state_queue = queue.Queue()
    for index, token in enumerate(tokens):
        if index < order:
            current_state_queue.put(token)
            if index == order - 1:
                current_state = ' '.join(list(current_state_queue.queue))
        elif index < len(tokens):
            current_state_queue.get()
            current_state_queue.put(token)
            next_state = ' '.join(list(current_state_queue.queue))
            markov_chain[current_state][next_state] += 1
            current_state = next_state
    return markov_chain


def get_random_state(markov_chain):
    uppercase_states = [state for state in markov_chain.keys() if state[0].isupper()]
    if len(uppercase_states) == 0:
        return random.choice(list(markov_chain.keys()))
    return random.choice(uppercase_states)


def generate_text(markov_chain, words):
    state = get_random_state(markov_chain)
    text = state.split()[:words]
    url_count = 0
    max_url_count = 1
    slur_count = 0
    max_slur_count = 1
    while len(text) < words:
        state = get_next_state(markov_chain, state)
        if state is None:
            state = get_random_state(markov_chain)
        end_word = state.split()[-1]
        urls = re.findall(r'(http|ftp|https):\/\/([\w_-]+(?:(?:\.[\w_-]+)+))([\w.,@?^=%&:\/~+#-]*[\w@?^=%&\/~+#-])', end_word)
        mentions = re.findall(r'<@.*>', end_word)
        if mentions:
            continue
        if urls:
            url_count += 1
            if url_count > max_url_count or random.random() > 0.2:
                continue

        text.append(end_word)
    return ' '.join(text)

#if __name__ == '__main__':
    #filename = "lol.txt"
    #order = 1
    #word_amount = 20

    #tokens = tokenise_text_file(filename)
    #markov_chain = create_markov_chain(tokens, order=order)
    #print(generate_text(markov_chain, word_amount))
